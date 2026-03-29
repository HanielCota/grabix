import { appConfig } from "@/server/config";
import { Errors } from "../domain/errors";
import type { AnalyzePageResult, MediaAsset } from "../domain/types";
import { fetchPageHtml } from "../infrastructure/html-fetcher";
import { extractMediaAndLinks, extractMediaFromHtml } from "../infrastructure/media-extractor";

export async function analyzePage(rawUrl: string, deepCrawl = false, signal?: AbortSignal): Promise<AnalyzePageResult> {
  if (!rawUrl?.trim()) {
    throw Errors.invalidUrl("URL não pode ser vazia.");
  }

  const { html, resolvedUrl } = await fetchPageHtml(rawUrl, signal);

  if (!html) {
    throw Errors.fetchFailed("HTML vazio recebido.");
  }

  if (!deepCrawl) {
    const assets = await extractMediaFromHtml(html, resolvedUrl);
    return {
      url: resolvedUrl,
      totalFound: assets.length,
      assets,
    };
  }

  // ─── Deep crawl: follow links to find more videos ───

  const { maxPages, maxDepth, concurrency, sameDomainOnly } = appConfig.crawl;
  const maxAssets = appConfig.limits.maxAssets;

  // Single cheerio parse for both media and links
  const initialResult = await extractMediaAndLinks(html, resolvedUrl);

  const visited = new Set<string>([normalizeForDedup(resolvedUrl)]);
  const allAssets = new Map<string, MediaAsset>();
  for (const a of initialResult.assets) {
    allAssets.set(a.url, a);
  }

  const baseDomain = getDomain(resolvedUrl);

  // Pre-filter and pre-mark links as visited to prevent races
  let queue: string[] = [];
  for (const link of initialResult.links) {
    const key = normalizeForDedup(link);
    if (visited.has(key)) continue;
    if (sameDomainOnly && getDomain(link) !== baseDomain) continue;
    visited.add(key);
    queue.push(link);
  }

  let pagesScanned = 1;

  // BFS crawl (depth limited)
  for (let depth = 0; depth < maxDepth && queue.length > 0; depth++) {
    const nextQueue: string[] = [];

    // Process in batches of `concurrency`
    for (let i = 0; i < queue.length && allAssets.size < maxAssets; i += concurrency) {
      // Only take as many as we can still scan
      const remaining = maxPages - pagesScanned;
      if (remaining <= 0) break;

      const batch = queue.slice(i, Math.min(i + concurrency, i + remaining));

      const results = await Promise.allSettled(
        batch.map(async (link) => {
          try {
            // fetchPageHtml already validates URL format and DNS
            const { html: pageHtml, resolvedUrl: pageUrl } = await fetchPageHtml(link, signal);
            const pageResult = await extractMediaAndLinks(pageHtml, pageUrl);

            return { media: pageResult.assets, links: pageResult.links };
          } catch {
            // Silently skip pages that fail (404, timeout, etc.)
            return null;
          }
        }),
      );

      // Count all pages attempted (even failed ones count toward the limit)
      pagesScanned += batch.length;

      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value) continue;

        for (const asset of result.value.media) {
          if (allAssets.size >= maxAssets) break;
          if (!allAssets.has(asset.url)) {
            allAssets.set(asset.url, asset);
          }
        }

        // Collect links for next depth level, pre-marking as visited
        if (depth + 1 < maxDepth) {
          for (const link of result.value.links) {
            const key = normalizeForDedup(link);
            if (visited.has(key)) continue;
            if (sameDomainOnly && getDomain(link) !== baseDomain) continue;
            visited.add(key);
            nextQueue.push(link);
          }
        }
      }
    }

    queue = nextQueue;
  }

  const finalAssets = Array.from(allAssets.values()).slice(0, maxAssets);

  return {
    url: resolvedUrl,
    totalFound: finalAssets.length,
    assets: finalAssets,
    pagesScanned,
  };
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function normalizeForDedup(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
