import * as cheerio from "cheerio";
import type { MediaAsset } from "@/features/media-downloader/domain/types";
import { extractMediaAndLinksFromDom } from "@/features/media-downloader/infrastructure/media-extractor";
import { safeFetch } from "@/server/safe-fetch";
import { discoverEmbeds } from "./embed-discovery";
import { discoverLinks } from "./link-discovery";
import { extractVideoInfo, isVideoPlatformDomain } from "./platform-registry";
import { crawlConfigSchema } from "./schemas";
import { Semaphore } from "./semaphore";
import type {
  CrawlConfig,
  CrawlResult,
  EmbeddedMedia,
  LinkCandidate,
  MediaItem,
  PageKind,
  PageResult,
  SSEEventMap,
  SSEEventName,
} from "./types";
import { normalizeUrl } from "./url-utils";

const GRABIX_USER_AGENT = "Mozilla/5.0 (compatible; Grabix/1.0; +https://github.com/HanielCota/grabix)";
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
const DOMAIN_DELAY_MS = 500;
const RETRY_DELAY_MS = 2000;
const MIN_TEXT_LENGTH_FOR_SPA = 500;
const MIN_LINKS_FOR_SPA = 3;

type EventEmitter = <E extends SSEEventName>(event: E, data: SSEEventMap[E]) => void;

interface ProcessedPage {
  result: PageResult;
  links: LinkCandidate[];
}

/**
 * Run the deep crawl orchestrator.
 */
export async function runDeepCrawl(
  url: string,
  partialConfig: Partial<CrawlConfig>,
  emit: EventEmitter,
  signal?: AbortSignal,
): Promise<CrawlResult> {
  const config = crawlConfigSchema.parse(partialConfig);
  const startTime = Date.now();

  emit("crawl_started", { url, config });

  const visited = new Set<string>();
  const seenMedia = new Set<string>(); // Cross-page media deduplication
  const domainTimestamps = new Map<string, number>();
  const semaphore = new Semaphore(config.maxConcurrent);
  const allResults: PageResult[] = [];
  let totalMediaCount = 0;
  let pagesWithErrors = 0;

  // ─── Process root page (single fetch: media + links) ───
  const rootNorm = normalizeUrl(url);
  visited.add(rootNorm);

  const root = await processPage(url, 0, config, domainTimestamps, emit, signal, seenMedia);
  allResults.push(root.result);

  if (root.result.error) {
    pagesWithErrors++;
  }
  totalMediaCount += root.result.media.length;

  // ─── BFS crawl ───
  let queue = filterAndMarkLinks(root.links, config, visited);
  let pagesDone = 1;

  for (let depth = 1; depth <= config.maxDepth && queue.length > 0; depth++) {
    if (signal?.aborted) break;

    const nextQueue: LinkCandidate[] = [];
    const pagesTotal = Math.min(queue.length + pagesDone, config.maxPages);

    // Emit discovered events
    for (const link of queue) {
      emit("page_discovered", {
        url: link.url,
        category: link.category,
        depth,
        source: link.source,
        fromUrl: link.discoveredFrom,
        discoveryReason: link.discoveryReason,
      });
    }

    // Claim slots before going concurrent to prevent exceeding maxPages
    const claimedLinks: typeof queue = [];
    for (const link of queue) {
      if (pagesDone >= config.maxPages) break;
      pagesDone++;
      claimedLinks.push(link);
    }

    let pagesCompleted = pagesDone - claimedLinks.length;

    // Process claimed pages concurrently
    const tasks = claimedLinks.map((link) => async () => {
      if (signal?.aborted) return;

      await semaphore.acquire();
      try {
        if (signal?.aborted) return;

        pagesCompleted++;
        emit("page_processing", {
          url: link.url,
          depth,
          pagesDone: pagesCompleted,
          pagesTotal,
        });

        const processed = await processPage(
          link.url,
          depth,
          config,
          domainTimestamps,
          emit,
          signal,
          seenMedia,
          link.discoveredFrom,
          link.discoveryReason,
        );
        allResults.push(processed.result);

        if (processed.result.error) {
          pagesWithErrors++;
        }
        totalMediaCount += processed.result.media.length;

        emit("page_complete", { url: link.url, mediaCount: processed.result.media.length, depth });

        // Collect links for next depth (already extracted, no re-fetch)
        if (depth < config.maxDepth && !processed.result.error) {
          const filtered = filterAndMarkLinks(processed.links, config, visited);
          nextQueue.push(...filtered);
        }
      } finally {
        semaphore.release();
      }
    });

    // Execute all tasks for this depth level
    await Promise.allSettled(tasks.map((fn) => fn()));
    queue = nextQueue;
  }

  const crawlResult: CrawlResult = {
    originalUrl: url,
    pagesCrawled: allResults.length,
    pagesWithErrors,
    totalMedia: totalMediaCount,
    results: allResults,
    crawlDurationMs: Date.now() - startTime,
  };

  emit("crawl_complete", {
    originalUrl: url,
    totalPages: crawlResult.pagesCrawled,
    pagesWithErrors,
    totalMedia: crawlResult.totalMedia,
    results: crawlResult.results,
    crawlDurationMs: crawlResult.crawlDurationMs,
  });

  return crawlResult;
}

// ─── Process a single page (fetch once, extract media + links) ───

async function processPage(
  url: string,
  depth: number,
  config: CrawlConfig,
  domainTimestamps: Map<string, number>,
  emit: EventEmitter,
  signal?: AbortSignal,
  seenMedia?: Set<string>,
  discoveredFrom: string | null = null,
  discoveryReason: string | null = null,
): Promise<ProcessedPage> {
  let html: string;
  try {
    html = await fetchPageWithRetry(url, config.requestTimeout, domainTimestamps, signal);
  } catch (err) {
    const error = err instanceof Error ? err.message : "unknown_error";
    const shortError = categorizeError(error);
    emit("page_error", { url, error: shortError, depth });
    return {
      result: {
        url,
        depth,
        title: null,
        media: [],
        error: shortError,
        possibleSpa: false,
        pageKind: "unknown",
        discoveredFrom,
        discoveryReason,
      },
      links: [],
    };
  }

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    emit("page_error", { url, error: "parse_error", depth });
    return {
      result: {
        url,
        depth,
        title: null,
        media: [],
        error: "parse_error",
        possibleSpa: false,
        pageKind: "unknown",
        discoveredFrom,
        discoveryReason,
      },
      links: [],
    };
  }

  // Get page title
  const title = $("title").first().text().trim().slice(0, 200) || null;

  const textContent = $("body").text().trim();
  const links = discoverLinks($, url);
  const possibleSpa = textContent.length < MIN_TEXT_LENGTH_FOR_SPA && links.length < MIN_LINKS_FOR_SPA;
  const embeds = discoverEmbeds($, url);
  const extractedMedia = await extractMediaAndLinksFromDom($, url, signal);

  // Filter out video platform links from structural navigation (nav/header/footer)
  // and ad regions, but keep ones in sidebars/asides (often legitimate content)
  const videoPlatformLinks = links.filter((l) => l.category === "video_platform" && !l.isNavigation);

  // Convert to MediaItems (deduplicate within page AND across pages)
  const media: MediaItem[] = [];
  const pageMediaKeys = new Set<string>();

  function addMedia(key: string, item: MediaItem) {
    if (pageMediaKeys.has(key)) return;
    if (seenMedia?.has(key)) return;
    pageMediaKeys.add(key);
    seenMedia?.add(key);
    media.push(item);
    emit("media_found", { pageUrl: url, media: item });
  }

  for (const asset of extractedMedia.assets) {
    addMedia(asset.url, assetToMediaItem(asset, url));
  }

  for (const embed of embeds) {
    const key = embed.canonicalUrl ?? (embed.videoId ? `${embed.platform}:${embed.videoId}` : embed.url);
    addMedia(key, embedToMediaItem(embed, url));
  }

  if (config.followVideoPlatforms) {
    for (const link of videoPlatformLinks) {
      const info = extractVideoInfo(link.url);
      if (!info) continue;

      const key = info.canonicalUrl;
      addMedia(key, {
        url: info.canonicalUrl,
        type: "video",
        platform: info.platform,
        videoId: info.videoId,
        title: link.anchorText || null,
        thumbnailUrl: info.thumbnailUrl,
        canonicalUrl: info.canonicalUrl,
        contentKind: info.kind,
        confidence: info.confidence,
        duration: null,
        source: "link",
        downloadable: false,
        discoveredFrom: url,
        discoveryReason: link.discoveryReason,
      });
    }
  }

  const pageKind = classifyPage(url, depth, media, links, videoPlatformLinks, possibleSpa);

  return {
    result: {
      url,
      depth,
      title,
      media,
      error: null,
      possibleSpa,
      pageKind,
      discoveredFrom,
      discoveryReason,
    },
    links,
  };
}

// ─── Fetch helpers ───

async function fetchPage(
  url: string,
  timeoutMs: number,
  domainTimestamps: Map<string, number>,
  signal?: AbortSignal,
): Promise<string> {
  // Rate limiting per domain
  await rateLimitDomain(url, domainTimestamps);

  const { response } = await safeFetch(url, {
    timeoutMs,
    signal,
    headers: {
      "User-Agent": GRABIX_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  // Check content-type
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`Not HTML: ${contentType}`);
  }

  // Check content-length heuristic
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!Number.isNaN(size) && size > MAX_BODY_SIZE) {
      throw new Error("Response too large");
    }
  }

  const text = await response.text();
  if (text.length > MAX_BODY_SIZE) {
    throw new Error("Response too large");
  }

  return text;
}

async function fetchPageWithRetry(
  url: string,
  timeoutMs: number,
  domainTimestamps: Map<string, number>,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await fetchPage(url, timeoutMs, domainTimestamps, signal);
  } catch (err) {
    // Retry once on 5xx errors
    if (err instanceof Error && err.message.startsWith("HTTP 5")) {
      await delay(RETRY_DELAY_MS);
      if (signal?.aborted) throw err;
      return await fetchPage(url, timeoutMs, domainTimestamps, signal);
    }
    throw err;
  }
}

async function rateLimitDomain(url: string, timestamps: Map<string, number>): Promise<void> {
  try {
    const domain = new URL(url).hostname;
    const lastRequest = timestamps.get(domain);
    const now = Date.now();

    if (lastRequest) {
      const elapsed = now - lastRequest;
      if (elapsed < DOMAIN_DELAY_MS) {
        await delay(DOMAIN_DELAY_MS - elapsed);
      }
    }

    timestamps.set(domain, Date.now());
  } catch {
    // Invalid URL — skip rate limiting
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Link filtering ───

function filterAndMarkLinks(candidates: LinkCandidate[], config: CrawlConfig, visited: Set<string>): LinkCandidate[] {
  const filtered: LinkCandidate[] = [];

  for (const link of candidates) {
    // Skip navigation if configured
    if (config.skipNavigationLinks && link.isNavigation) continue;

    // Category-based filtering
    if (link.category === "video_platform") continue;
    if (link.category === "same_domain" && !config.followSameDomain) continue;
    if (link.category === "subdomain" && !config.followSubdomains) continue;
    if (link.category === "external" && !config.followExternal) continue;

    // Don't crawl into video platform sites
    if (isVideoPlatformDomain(link.url)) continue;

    // Skip already visited (only mark after all other filters pass)
    const norm = normalizeUrl(link.url);
    if (visited.has(norm)) continue;
    visited.add(norm);

    filtered.push(link);
  }

  return filtered;
}

// ─── Conversion helpers ───

function assetToMediaItem(asset: MediaAsset, pageUrl: string): MediaItem {
  return {
    url: asset.url,
    type: asset.type === "IMAGE" ? "image" : "video",
    platform: null,
    videoId: null,
    title: asset.fileName,
    thumbnailUrl: asset.type === "IMAGE" ? asset.url : null,
    canonicalUrl: asset.url,
    contentKind: asset.type === "VIDEO" ? "video" : null,
    confidence: 0.92,
    duration: null,
    source: asset.sourceTag,
    downloadable: true,
    discoveredFrom: pageUrl,
    discoveryReason: "dom-extracted-asset",
  };
}

function embedToMediaItem(embed: EmbeddedMedia, pageUrl: string): MediaItem {
  return {
    url: embed.url,
    type: embed.type,
    platform: embed.platform,
    videoId: embed.videoId,
    title: null,
    thumbnailUrl: embed.thumbnailUrl,
    canonicalUrl: embed.canonicalUrl,
    contentKind: embed.contentKind,
    confidence: embed.confidence,
    duration: null,
    source: embed.source,
    downloadable: embed.downloadable,
    discoveredFrom: pageUrl,
    discoveryReason: embed.discoveryReason,
  };
}

function categorizeError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("aborterror")) return "timeout";
  if (message.includes("HTTP 403") || message.includes("HTTP 401")) return "auth_required";
  if (message.includes("HTTP 429")) return "rate_limited";
  if (message.includes("HTTP 5")) return "server_error";
  if (lower.includes("not html")) return "not_html";
  if (lower.includes("too large")) return "too_large";
  if (lower.includes("blocked")) return "blocked";
  if (lower.includes("enotfound") || lower.includes("unreachable") || lower.includes("fetch failed"))
    return "unreachable";
  return "unknown_error";
}

function classifyPage(
  url: string,
  depth: number,
  media: MediaItem[],
  links: LinkCandidate[],
  videoPlatformLinks: LinkCandidate[],
  possibleSpa: boolean,
): PageKind {
  if (isVideoPlatformDomain(url)) return "platform";

  if (media.length > 0 || videoPlatformLinks.length > 0) {
    return "media";
  }

  const contentHubLinks = links.filter(
    (link) =>
      (link.category === "same_domain" || link.category === "subdomain") &&
      (link.discoveryReason === "content-hub" ||
        link.discoveryReason === "interactive-destination" ||
        link.discoveryReason === "data-settings-link"),
  ).length;

  const interactiveLinks = links.filter((link) => link.interactive && !link.isNavigation).length;

  if (contentHubLinks >= 3 || (possibleSpa && interactiveLinks >= 2)) {
    return "hub";
  }

  if (interactiveLinks > 0 || links.filter((link) => !link.isNavigation).length >= 5) {
    return depth === 0 ? "landing" : "listing";
  }

  return depth === 0 ? "landing" : "unknown";
}
