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
  /["']?(?:mediaUrl|media_url|sourceUrl|source_url|videoUrl|video_url)["']?\s*[:=]\s*["'](https?:\/\/[^"']+?)["']/gi,
  // CDN URLs specific to converteai / vturb
  /["'](https?:\/\/(?:cdn|media|stream)[^"']*?\.(?:converteai|vturb)[^"']*?\.(?:net|com|com\.br)\/[^"']+?\.(?:m3u8|mp4|webm)(?:\?[^"']*)?)["']/gi,
  // HLS / MP4 with common video path segments (main.m3u8, index.m3u8, etc.)
  /["'](https?:\/\/[^"']+?\/(?:main|index|video|media|playlist)\.(?:m3u8|mp4))["']/gi,
];

// Pattern to match Vturb/ConvertAI script src attributes
const VTURB_SCRIPT_SRC_PATTERN = /^https?:\/\/(?:scripts|cdn|player)\.(?:converteai\.net|vturb\.com(?:\.br)?)\//i;

// Pattern to extract account/player IDs from Vturb URLs
const VTURB_PLAYER_PATH_PATTERN = /\/([a-f0-9-]+)\/players\/([a-f0-9-]+)\//i;

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
 * Accepts a pre-parsed CheerioAPI to avoid duplicate HTML parsing.
 */
export async function extractVturbVideos(
  $: CheerioAPI,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<VturbVideoResult[]> {
  const results: VturbVideoResult[] = [];
  const seen = new Set<string>();

  // 1. Find Vturb <script src="..."> tags
  const scriptUrls: VturbScriptRef[] = [];

  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || !VTURB_SCRIPT_SRC_PATTERN.test(resolved)) return;

    const pathMatch = resolved.match(VTURB_PLAYER_PATH_PATTERN);
    if (pathMatch) {
      scriptUrls.push({
        src: resolved,
        accountId: pathMatch[1],
        playerId: pathMatch[2],
      });
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
      // For iframes, derive the player.js URL from the embed URL
      const playerJsUrl = resolved.replace(/\/embed\.html.*$/, "/player.js");
      scriptUrls.push({
        src: playerJsUrl,
        accountId: pathMatch[1],
        playerId: pathMatch[2],
      });
    }
  });

  // 3. Check inline scripts for Vturb/smartplayer initialization
  $("script:not([src])").each((_, el) => {
    const text = $(el).html();
    if (!text || text.length > 500_000) return;
    if (!VTURB_INLINE_HINTS.some((p) => p.test(text))) return;

    // Look for script URLs embedded in inline code
    const srcMatches = text.matchAll(
      /["'](https?:\/\/(?:scripts|cdn|player)\.(?:converteai\.net|vturb\.com(?:\.br)?)\/[^"']+?player\.js[^"']*)["']/gi,
    );
    for (const m of srcMatches) {
      const url = m[1];
      const pathMatch = url.match(VTURB_PLAYER_PATH_PATTERN);
      if (pathMatch) {
        scriptUrls.push({
          src: url,
          accountId: pathMatch[1],
          playerId: pathMatch[2],
        });
      }
    }

    // Also try to extract video URLs directly from inline scripts
    const directVideos = extractVideoUrlsFromContent(text);
    for (const videoUrl of directVideos) {
      if (seen.has(videoUrl)) continue;
      seen.add(videoUrl);
      results.push({
        url: videoUrl,
        playerId: "inline",
        accountId: "inline",
        sourceUrl: baseUrl,
      });
    }
  });

  // 4. Fetch each player.js and extract video URLs
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
      // Silently skip failed fetches - the player.js might be protected or unavailable
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
  // Accept JS, HTML, or JSON responses
  const isValidType =
    contentType.includes("javascript") ||
    contentType.includes("text/html") ||
    contentType.includes("application/json") ||
    contentType.includes("text/plain");

  if (!isValidType) return [];

  const text = await response.text();
  if (!text || text.length > 2 * 1024 * 1024) return []; // Skip if > 2MB

  return extractVideoUrlsFromContent(text);
}

/**
 * Extracts video URLs from Vturb player script content.
 */
function extractVideoUrlsFromContent(content: string): string[] {
  const urls = new Set<string>();

  for (const pattern of VTURB_VIDEO_URL_PATTERNS) {
    // Reset regex state (global flag)
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const url = match[1];
      if (!url) continue;

      // Skip non-video URLs (JS, CSS, images, tracking pixels, etc.)
      if (isNonVideoUrl(url)) continue;

      // Must end with a known video extension
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
    const key = `${s.accountId}:${s.playerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
