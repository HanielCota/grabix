import type { CheerioAPI } from "cheerio";
import { appConfig } from "@/server/config";
import { safeFetch } from "@/server/safe-fetch";

export interface VturbVideoResult {
  url: string;
  playerId: string;
  accountId: string;
  /** The source script or iframe URL that led to this discovery */
  sourceUrl: string;
}

// Patterns to find video URLs inside Vturb player.js content.
// Ordered from most specific to least specific to favor high-quality matches.
const VTURB_VIDEO_URL_PATTERNS = [
  // mediaUrl / media_url / sourceUrl etc. in JSON-like config
  /["']?(?:mediaUrl|media_url|sourceUrl|source_url|videoUrl|video_url|hls_url|hlsUrl|dash_url|dashUrl)["']?\s*[:=]\s*["'](https?:\/\/[^"']+?)["']/gi,
  // CDN URLs specific to converteai / vturb (including regional CDNs)
  /["'](https?:\/\/(?:cdn|na-cdn|cdn-bb|cdn-k|cdn-cf-bb|media|stream|assets)[^"']*?\.(?:converteai|vturb)[^"']*?\.(?:net|com|com\.br)\/[^"']+?\.(?:m3u8|mp4|webm)(?:\?[^"']*)?)["']/gi,
  // HLS / MP4 with common video path segments (main.m3u8, index.m3u8, etc.)
  /["'](https?:\/\/[^"']+?\/(?:main|index|video|media|playlist)\.(?:m3u8|mp4))["']/gi,
];

// Pattern to match Vturb/ConvertAI script src attributes (all known subdomains)
const VTURB_SCRIPT_SRC_PATTERN =
  /^https?:\/\/(?:scripts|cdn|na-cdn|cdn-bb|cdn-k|cdn-cf-bb|player|images)\.(?:converteai\.net|vturb\.com(?:\.br)?)\//i;

// Pattern to extract account/player IDs from Vturb URLs.
// Handles both legacy (/{accountId}/players/{playerId}/player.js)
// and v4 (/{accountId}/players/{playerId}/v4/player.js) paths.
const VTURB_PLAYER_PATH_PATTERN = /\/([a-f0-9-]+)\/players\/([a-f0-9-]+)\//i;

// Pattern for AB test paths: /{accountId}/ab-test/{scriptId}/player.js
const VTURB_AB_TEST_PATTERN = /\/([a-f0-9-]+)\/ab-test\/([a-f0-9-]+)\//i;

// Inline script patterns that reference Vturb/smartplayer
const VTURB_INLINE_HINTS = [/smartplayer/i, /converteai/i, /vturb/i, /smartvideo/i];

interface VturbScriptRef {
  src: string;
  accountId: string;
  playerId: string;
}

/**
 * Detects Vturb (ConvertAI) video players embedded in a page and resolves their
 * actual video source URLs by fetching the player.js script.
 *
 * Supports both legacy and v4 architectures:
 * - Legacy: <script src=".../{accountId}/players/{playerId}/player.js">
 * - v4: <vturb-smartplayer> + <script src=".../{accountId}/players/{playerId}/v4/player.js">
 */
export async function extractVturbVideos(
  $: CheerioAPI,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<VturbVideoResult[]> {
  const results: VturbVideoResult[] = [];
  const seen = new Set<string>();
  const scriptUrls: VturbScriptRef[] = [];

  // 1. Find Vturb <script src="..."> tags (both legacy and v4)
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || !VTURB_SCRIPT_SRC_PATTERN.test(resolved)) return;

    const pathMatch = resolved.match(VTURB_PLAYER_PATH_PATTERN);
    if (pathMatch) {
      scriptUrls.push({ src: resolved, accountId: pathMatch[1], playerId: pathMatch[2] });
      return;
    }

    const abMatch = resolved.match(VTURB_AB_TEST_PATTERN);
    if (abMatch) {
      scriptUrls.push({ src: resolved, accountId: abMatch[1], playerId: abMatch[2] });
    }
  });

  // 2. Find Vturb <iframe> embeds
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src");
    if (!src) return;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || !VTURB_SCRIPT_SRC_PATTERN.test(resolved)) return;

    const pathMatch = resolved.match(VTURB_PLAYER_PATH_PATTERN);
    if (pathMatch) {
      // Try both v4 and legacy player.js paths
      const basePath = resolved.replace(/\/(embed\.html|player\.js).*$/, "");
      scriptUrls.push({ src: `${basePath}/v4/player.js`, accountId: pathMatch[1], playerId: pathMatch[2] });
      scriptUrls.push({ src: `${basePath}/player.js`, accountId: pathMatch[1], playerId: pathMatch[2] });
    }
  });

  // 3. Detect <vturb-smartplayer> web components (v4 architecture)
  $("vturb-smartplayer").each((_, el) => {
    const id = $(el).attr("id") ?? "";
    // Extract hex ID from id="vid-{hexId}" pattern
    const vidMatch = id.match(/^vid-([a-f0-9]+)$/i);
    if (vidMatch) {
      // The <vturb-smartplayer> element itself doesn't have the script URL.
      // The player.js is loaded via a sibling/nearby <script> tag.
      // We rely on step 1 and 4 to find the script URL.
      // However, we store the element ID for correlation.
    }
  });

  // 4. Check inline scripts for dynamically created Vturb script tags
  $("script:not([src])").each((_, el) => {
    const text = $(el).html();
    if (!text || text.length > 500_000) return;
    if (!VTURB_INLINE_HINTS.some((p) => p.test(text))) return;

    // Match dynamically injected script URLs (common Vturb embed pattern):
    // s.src = "https://scripts.converteai.net/{accountId}/players/{playerId}/v4/player.js"
    const srcMatches = text.matchAll(
      /["'](https?:\/\/(?:scripts|cdn|player)\.(?:converteai\.net|vturb\.com(?:\.br)?)\/[^"']+?player\.js[^"']*)["']/gi,
    );
    for (const m of srcMatches) {
      const url = m[1];
      const pathMatch = url.match(VTURB_PLAYER_PATH_PATTERN);
      if (pathMatch) {
        scriptUrls.push({ src: url, accountId: pathMatch[1], playerId: pathMatch[2] });
        continue;
      }
      const abMatch = url.match(VTURB_AB_TEST_PATTERN);
      if (abMatch) {
        scriptUrls.push({ src: url, accountId: abMatch[1], playerId: abMatch[2] });
      }
    }

    // Also try to extract video URLs directly from inline scripts
    const directVideos = extractVideoUrlsFromContent(text);
    for (const videoUrl of directVideos) {
      if (seen.has(videoUrl)) continue;
      seen.add(videoUrl);
      results.push({ url: videoUrl, playerId: "inline", accountId: "inline", sourceUrl: baseUrl });
    }
  });

  // 5. Fetch each player.js and extract video URLs
  const uniqueScripts = deduplicateByPlayerId(scriptUrls);

  const fetchPromises = uniqueScripts.map(async (script) => {
    try {
      const videoUrls = await fetchAndParsePlayerScript(script.src, baseUrl, signal);
      for (const videoUrl of videoUrls) {
        if (seen.has(videoUrl)) continue;
        seen.add(videoUrl);
        results.push({
          url: videoUrl,
          playerId: script.playerId,
          accountId: script.accountId,
          sourceUrl: script.src,
        });
      }
    } catch {
      // Silently skip failed fetches
    }
  });

  await Promise.allSettled(fetchPromises);

  return results;
}

/**
 * Fetches a Vturb player.js script and extracts video source URLs from it.
 */
async function fetchAndParsePlayerScript(
  playerJsUrl: string,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const { response } = await safeFetch(playerJsUrl, {
    timeoutMs: appConfig.limits.fetchTimeoutMs,
    signal,
    headers: {
      "User-Agent": appConfig.userAgent,
      Accept: "*/*",
      Referer: pageUrl,
      Origin: new URL(pageUrl).origin,
    },
  });

  if (!response.ok) return [];

  const contentType = response.headers.get("content-type") ?? "";
  const isValidType =
    contentType.includes("javascript") ||
    contentType.includes("text/html") ||
    contentType.includes("application/json") ||
    contentType.includes("text/plain");

  if (!isValidType) return [];

  const text = await response.text();
  if (!text || text.length > 2 * 1024 * 1024) return [];

  return extractVideoUrlsFromContent(text);
}

/**
 * Extracts video URLs from Vturb player script content.
 */
function extractVideoUrlsFromContent(content: string): string[] {
  const urls = new Set<string>();

  for (const pattern of VTURB_VIDEO_URL_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const url = match[1];
      if (!url) continue;
      if (isNonVideoUrl(url)) continue;
      if (isPlausibleVideoUrl(url)) {
        urls.add(url);
      }
    }
  }

  return Array.from(urls);
}

function isNonVideoUrl(url: string): boolean {
  return (
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|#|$)/i.test(url) ||
    url.includes("analytics") ||
    url.includes("tracking") ||
    url.includes("pixel") ||
    url.includes("beacon") ||
    url.includes("gtm") ||
    url.includes("google-analytics")
  );
}

function isPlausibleVideoUrl(url: string): boolean {
  return /\.(m3u8|mp4|webm|mov|mpd)(\?|#|$)/i.test(url);
}

function resolveUrl(raw: string, base: string): string | null {
  try {
    const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
    return new URL(normalized, base).toString();
  } catch {
    return null;
  }
}

function deduplicateByPlayerId(scripts: VturbScriptRef[]): VturbScriptRef[] {
  const seen = new Set<string>();
  return scripts.filter((s) => {
    const key = `${s.accountId}:${s.playerId}:${s.src}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
