import type { CheerioAPI } from "cheerio";
import { appConfig } from "@/server/config";
import { safeFetch } from "@/server/safe-fetch";

export interface VturbVideoResult {
  url: string;
  playerId: string;
  accountId: string;
  thumbnailUrl: string | null;
  sourceUrl: string;
}

// Pattern to match Vturb/ConvertAI script src attributes (all known subdomains)
const VTURB_SCRIPT_SRC_PATTERN =
  /^https?:\/\/(?:scripts|cdn|na-cdn|cdn-bb|cdn-k|cdn-cf-bb|player|images)\.(?:converteai\.net|vturb\.com(?:\.br)?)\//i;

// Pattern to extract account/player IDs from Vturb URLs.
const VTURB_PLAYER_PATH_PATTERN = /\/([a-f0-9-]+)\/players\/([a-f0-9-]+)\//i;

// Pattern for AB test paths
const VTURB_AB_TEST_PATTERN = /\/([a-f0-9-]+)\/ab-test\/([a-f0-9-]+)\//i;

// Inline script patterns that reference Vturb/smartplayer
const VTURB_INLINE_HINTS = [/smartplayer/i, /converteai/i, /vturb/i, /smartvideo/i];

// ─── V4 config extraction patterns ───
// In v4 player.js, the config is embedded as a JS object literal.
// We extract the key fields: cdn, oid, and video.id.
const V4_CDN_PATTERN = /cdn\s*:\s*["']([^"']+)["']/;
const V4_OID_PATTERN = /oid\s*:\s*["']([a-f0-9-]+)["']/;
const V4_VIDEO_ID_PATTERN = /video\s*:\s*\{[^}]*?id\s*:\s*["']([a-f0-9]+)["']/;
const V4_VIDEO_COVER_PATTERN = /video\s*:\s*\{[^}]*?(?:cover|poster)\s*:\s*["'](https?:\/\/[^"']+)["']/;

// Legacy patterns: direct video URLs in older player.js
const LEGACY_VIDEO_URL_PATTERNS = [
  /["']?(?:mediaUrl|media_url|sourceUrl|source_url|videoUrl|video_url|hls_url|hlsUrl)["']?\s*[:=]\s*["'](https?:\/\/[^"']+?)["']/gi,
  /["'](https?:\/\/(?:cdn|na-cdn|cdn-bb|cdn-k|cdn-cf-bb|media|stream)[^"']*?\.(?:converteai|vturb)[^"']*?\.(?:net|com|com\.br)\/[^"']+?\.(?:m3u8|mp4|webm)(?:\?[^"']*)?)["']/gi,
];

interface VturbScriptRef {
  src: string;
  accountId: string;
  playerId: string;
}

/**
 * Detects Vturb (ConvertAI) video players embedded in a page and resolves their
 * actual video source URLs by fetching and parsing the player.js script.
 *
 * V4 architecture: the player.js contains a config object with `cdn`, `oid`,
 * and `video.id` fields. The actual HLS URL is constructed as:
 *   https://{cdn}/{oid}/{videoId}/main.m3u8
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

    addScriptRef(resolved, scriptUrls);
  });

  // 2. Find Vturb <iframe> embeds
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src");
    if (!src) return;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || !VTURB_SCRIPT_SRC_PATTERN.test(resolved)) return;

    const pathMatch = resolved.match(VTURB_PLAYER_PATH_PATTERN);
    if (pathMatch) {
      const basePath = resolved.replace(/\/(embed\.html|player\.js).*$/, "");
      scriptUrls.push({ src: `${basePath}/v4/player.js`, accountId: pathMatch[1], playerId: pathMatch[2] });
      scriptUrls.push({ src: `${basePath}/player.js`, accountId: pathMatch[1], playerId: pathMatch[2] });
    }
  });

  // 3. Check inline scripts for dynamically created Vturb script tags
  //    This is the most common v4 pattern:
  //    var s=document.createElement("script");
  //    s.src="https://scripts.converteai.net/{oid}/players/{playerId}/v4/player.js"
  $("script:not([src])").each((_, el) => {
    const text = $(el).html();
    if (!text || text.length > 500_000) return;
    if (!VTURB_INLINE_HINTS.some((p) => p.test(text))) return;

    const srcMatches = text.matchAll(
      /["'](https?:\/\/(?:scripts|cdn|player)\.(?:converteai\.net|vturb\.com(?:\.br)?)\/[^"']+?player\.js[^"']*)["']/gi,
    );
    for (const m of srcMatches) {
      addScriptRef(m[1], scriptUrls);
    }
  });

  // 4. Fetch each player.js and extract video URLs
  const uniqueScripts = deduplicateScripts(scriptUrls);

  const fetchPromises = uniqueScripts.map(async (script) => {
    try {
      const extracted = await fetchAndParsePlayerScript(script.src, baseUrl, signal);
      for (const video of extracted) {
        if (seen.has(video.url)) continue;
        seen.add(video.url);
        results.push({
          url: video.url,
          playerId: script.playerId,
          accountId: script.accountId,
          thumbnailUrl: video.thumbnailUrl,
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

interface ExtractedVideo {
  url: string;
  thumbnailUrl: string | null;
}

/**
 * Fetches a Vturb player.js script and extracts the video HLS URL.
 *
 * For v4: parses the embedded config to build https://{cdn}/{oid}/{videoId}/main.m3u8
 * For legacy: falls back to regex-based URL extraction.
 */
async function fetchAndParsePlayerScript(
  playerJsUrl: string,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<ExtractedVideo[]> {
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

  // Try v4 config extraction first
  const v4Results = extractFromV4Config(text);
  if (v4Results.length > 0) return v4Results;

  // Fall back to legacy regex extraction
  return extractLegacyVideoUrls(text);
}

/**
 * Extracts video URL from v4 player.js config by parsing the embedded
 * cdn, oid, and video.id fields, then constructing the HLS URL.
 */
function extractFromV4Config(content: string): ExtractedVideo[] {
  const cdnMatch = content.match(V4_CDN_PATTERN);
  const oidMatch = content.match(V4_OID_PATTERN);
  const videoIdMatch = content.match(V4_VIDEO_ID_PATTERN);

  if (!cdnMatch || !oidMatch || !videoIdMatch) return [];

  const cdn = cdnMatch[1];
  const oid = oidMatch[1];
  const videoId = videoIdMatch[1];

  // Construct the HLS master playlist URL
  const hlsUrl = `https://${cdn}/${oid}/${videoId}/main.m3u8`;

  // Try to extract thumbnail/cover
  const coverMatch = content.match(V4_VIDEO_COVER_PATTERN);
  const thumbnailUrl = coverMatch?.[1] ?? null;

  return [{ url: hlsUrl, thumbnailUrl }];
}

/**
 * Fallback: extracts direct video URLs from legacy player.js content.
 */
function extractLegacyVideoUrls(content: string): ExtractedVideo[] {
  const urls = new Set<string>();

  for (const pattern of LEGACY_VIDEO_URL_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const url = match[1];
      if (!url) continue;
      if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|#|$)/i.test(url)) continue;
      if (/\.(m3u8|mp4|webm|mov|mpd)(\?|#|$)/i.test(url)) {
        urls.add(url);
      }
    }
  }

  return Array.from(urls).map((url) => ({ url, thumbnailUrl: null }));
}

function addScriptRef(resolved: string, scriptUrls: VturbScriptRef[]): void {
  const pathMatch = resolved.match(VTURB_PLAYER_PATH_PATTERN);
  if (pathMatch) {
    scriptUrls.push({ src: resolved, accountId: pathMatch[1], playerId: pathMatch[2] });
    return;
  }
  const abMatch = resolved.match(VTURB_AB_TEST_PATTERN);
  if (abMatch) {
    scriptUrls.push({ src: resolved, accountId: abMatch[1], playerId: abMatch[2] });
  }
}

function resolveUrl(raw: string, base: string): string | null {
  try {
    const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
    return new URL(normalized, base).toString();
  } catch {
    return null;
  }
}

function deduplicateScripts(scripts: VturbScriptRef[]): VturbScriptRef[] {
  const seen = new Set<string>();
  return scripts.filter((s) => {
    const key = `${s.accountId}:${s.playerId}:${s.src}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
