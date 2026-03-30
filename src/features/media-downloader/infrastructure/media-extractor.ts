import * as cheerio from "cheerio";
import { sanitizeFileName } from "@/lib/files/file-name";
import { isHttpUrl } from "@/lib/url/public-url";
import { extractVturbVideos } from "@/lib/vturb/vturb-extractor";
import { appConfig } from "@/server/config";
import {
  classifyByExtension,
  extensionFromMime,
  getExtensionFromUrl,
  getFileNameFromUrl,
  isMediaExtension,
} from "../domain/media-extensions";
import type { MediaAsset } from "../domain/types";

interface RawMediaRef {
  url: string;
  sourceTag: string;
  /** Extension inferred from MIME type or platform (used when URL has no extension) */
  inferredExt?: string;
}

// Common lazy-load attributes used by WP Rocket, lazysizes, native lazy, etc.
const LAZY_SRC_ATTRS = ["src", "data-src", "data-lazy-src", "data-original", "data-bg"];

const LAZY_SRCSET_ATTRS = ["srcset", "data-srcset", "data-lazy-srcset"];

type CheerioEl = ReturnType<ReturnType<typeof cheerio.load>>;

function pushAttr(el: CheerioEl, attr: string, tag: string, refs: RawMediaRef[], inferredExt?: string) {
  const val = el.attr(attr);
  if (val) refs.push({ url: val, sourceTag: `${tag}[${attr}]`, inferredExt });
}

function parseSrcset(srcset: string): string[] {
  return srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function pushSrcsetAttrs(el: CheerioEl, tag: string, refs: RawMediaRef[]) {
  for (const attr of LAZY_SRCSET_ATTRS) {
    const val = el.attr(attr);
    if (!val) continue;
    for (const url of parseSrcset(val)) {
      refs.push({ url, sourceTag: `${tag}[${attr}]` });
    }
  }
}

// ─── Embedded video platform helpers ───

interface EmbedInfo {
  thumbnail: string;
  inferredExt: string;
}

function extractYouTubeId(url: string): string | null {
  try {
    // Handle protocol-relative URLs (//www.youtube.com/embed/...)
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, "");

    // youtube.com/embed/VIDEO_ID or youtube-nocookie.com/embed/VIDEO_ID
    if ((host === "youtube.com" || host === "youtube-nocookie.com") && u.pathname.startsWith("/embed/")) {
      return u.pathname.split("/")[2] || null;
    }

    // youtube.com/watch?v=VIDEO_ID
    if (host === "youtube.com" && u.searchParams.has("v")) {
      return u.searchParams.get("v");
    }

    // youtu.be/VIDEO_ID
    if (host === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
  } catch {}
  return null;
}

function extractVimeoId(url: string): string | null {
  try {
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "player.vimeo.com" && u.pathname.startsWith("/video/")) {
      return u.pathname.split("/")[2] || null;
    }
    if (host === "vimeo.com") {
      const match = u.pathname.match(/^\/(\d+)/);
      return match?.[1] ?? null;
    }
  } catch {}
  return null;
}

function getEmbedInfo(iframeSrc: string): EmbedInfo | null {
  const ytId = extractYouTubeId(iframeSrc);
  if (ytId) {
    return {
      thumbnail: `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`,
      inferredExt: "jpg",
    };
  }

  const vimeoId = extractVimeoId(iframeSrc);
  if (vimeoId) {
    return {
      thumbnail: `https://vumbnail.com/${vimeoId}.jpg`,
      inferredExt: "jpg",
    };
  }

  return null;
}

// ─── Main extraction ───

export interface ExtractionResult {
  assets: MediaAsset[];
  links: string[];
}

export async function extractMediaFromHtml(html: string, baseUrl: string, signal?: AbortSignal): Promise<MediaAsset[]> {
  const result = await extractMediaAndLinks(html, baseUrl, signal);
  return result.assets;
}

export async function extractMediaAndLinks(
  html: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const $ = cheerio.load(html);
  return await extractMediaAndLinksFromDom($, baseUrl, signal);
}

export async function extractMediaAndLinksFromDom(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const rawRefs: RawMediaRef[] = [];

  // img - all lazy-load variants + srcset (skip those inside <picture>, handled below)
  $("img").each((_, el) => {
    const $el = $(el);
    if ($el.parent("picture").length) return;
    for (const attr of LAZY_SRC_ATTRS) {
      pushAttr($el, attr, "img", rawRefs);
    }
    pushSrcsetAttrs($el, "img", rawRefs);
  });

  // video[src] + lazy variants + poster
  $("video").each((_, el) => {
    const $el = $(el);
    for (const attr of LAZY_SRC_ATTRS) {
      pushAttr($el, attr, "video", rawRefs);
    }
    // poster is an image
    const poster = $el.attr("poster");
    if (poster) rawRefs.push({ url: poster, sourceTag: "video[poster]" });
  });

  // source[src] + lazy variants (skip those inside <picture>, handled below)
  $("source").each((_, el) => {
    const $el = $(el);
    if ($el.parent("picture").length) return;
    const mimeType = $el.attr("type") ?? "";
    const inferredExt = extensionFromMime(mimeType) ?? undefined;

    for (const attr of LAZY_SRC_ATTRS) {
      pushAttr($el, attr, "source", rawRefs, inferredExt);
    }
    pushSrcsetAttrs($el, "source", rawRefs);
  });

  // a[href] with media extensions
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const resolved = resolveUrl(href, baseUrl);
      if (resolved) {
        const ext = getExtensionFromUrl(resolved);
        if (ext && isMediaExtension(ext)) {
          rawRefs.push({ url: resolved, sourceTag: "a[href]" });
        }
      }
    }
  });

  // Images inside <noscript> (lazy-load fallbacks)
  $("noscript").each((_, el) => {
    const inner = $(el).html();
    if (!inner) return;
    const $inner = cheerio.load(inner);
    $inner("img").each((_, imgEl) => {
      const src = $inner(imgEl).attr("src");
      if (src) rawRefs.push({ url: src, sourceTag: "noscript img[src]" });
    });
  });

  // ─── <picture> tags (art direction / responsive images) ───

  $("picture").each((_, el) => {
    const $pic = $(el);

    // Extract from <source> children (srcset / src)
    $pic.find("source").each((_, srcEl) => {
      const $src = $(srcEl);
      const mimeType = $src.attr("type") ?? "";
      const inferredExt = extensionFromMime(mimeType) ?? undefined;

      for (const attr of LAZY_SRCSET_ATTRS) {
        const val = $src.attr(attr);
        if (!val) continue;
        for (const url of parseSrcset(val)) {
          rawRefs.push({ url, sourceTag: `picture source[${attr}]`, inferredExt });
        }
      }
      for (const attr of LAZY_SRC_ATTRS) {
        pushAttr($src, attr, "picture source", rawRefs, inferredExt);
      }
    });

    // Fallback <img> inside <picture>
    const $img = $pic.find("img");
    if ($img.length) {
      for (const attr of LAZY_SRC_ATTRS) {
        pushAttr($img, attr, "picture img", rawRefs);
      }
      pushSrcsetAttrs($img, "picture img", rawRefs);
    }
  });

  // ─── CSS background-image (inline styles + <style> blocks) ───

  // Inline styles: any element with style="...background-image: url(...)..."
  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    if (style) extractCssBackgroundUrls(style, rawRefs);
  });

  // <style> blocks
  $("style").each((_, el) => {
    const css = $(el).html();
    if (css) extractCssBackgroundUrls(css, rawRefs);
  });

  // ─── Embedded videos (iframe, embed, object) ───

  // iframe - detect known video platforms (YouTube, Vimeo) and extract thumbnails
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src");
    if (!src) return;

    const embedInfo = getEmbedInfo(src);
    if (embedInfo) {
      rawRefs.push({
        url: embedInfo.thumbnail,
        sourceTag: "iframe[src]",
        inferredExt: embedInfo.inferredExt,
      });
    }
  });

  // embed[src] - direct embedded media
  $("embed").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");
    const type = $el.attr("type") ?? "";
    if (src) {
      const inferredExt = extensionFromMime(type) ?? undefined;
      rawRefs.push({ url: src, sourceTag: "embed[src]", inferredExt });
    }
  });

  // object[data] - direct embedded media
  $("object").each((_, el) => {
    const $el = $(el);
    const data = $el.attr("data");
    const type = $el.attr("type") ?? "";
    if (data) {
      const inferredExt = extensionFromMime(type) ?? undefined;
      rawRefs.push({ url: data, sourceTag: "object[data]", inferredExt });
    }
  });

  // ─── Meta tags (og:video, twitter:player) ───

  const metaVideoAttrs = ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream", "twitter:player"];

  for (const prop of metaVideoAttrs) {
    const content = $(`meta[property="${prop}"]`).attr("content") ?? $(`meta[name="${prop}"]`).attr("content");
    if (!content) continue;

    // Skip embed page URLs (YouTube, Vimeo, etc.) — they are HTML pages, not video files
    if (extractYouTubeId(content) || extractVimeoId(content)) continue;

    rawRefs.push({ url: content, sourceTag: `meta[${prop}]`, inferredExt: "mp4" });
  }

  // og:image (many pages expose a video thumbnail here)
  const ogImage = $('meta[property="og:image"]').attr("content") ?? $('meta[name="og:image"]').attr("content");
  if (ogImage) {
    rawRefs.push({ url: ogImage, sourceTag: "meta[og:image]" });
  }

  // ─── JSON-LD structured data (schema.org VideoObject) ───

  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).html();
    if (!text) return;
    try {
      const data = JSON.parse(text);
      extractVideoFromJsonLd(data, rawRefs);
    } catch {
      // Malformed JSON-LD — skip
    }
  });

  // ─── Inline scripts: extract video URLs from JS/JSON configs ───

  $("script:not([src])").each((_, el) => {
    const text = $(el).html();
    if (!text || text.length > 500_000) return; // Skip huge scripts
    extractVideoUrlsFromScript(text, rawRefs);
  });

  // ─── data-* attributes on any element that contain video URLs ───

  $(
    "[data-video-src], [data-video-url], [data-video], [data-file-url], [data-mp4], [data-src-mp4], [data-webm], [data-src-webm], [data-hls], [data-stream-url]",
  ).each((_, el) => {
    const $el = $(el);
    const videoDataAttrs = [
      "data-video-src",
      "data-video-url",
      "data-video",
      "data-file-url",
      "data-mp4",
      "data-src-mp4",
      "data-webm",
      "data-src-webm",
      "data-hls",
      "data-stream-url",
    ];
    for (const attr of videoDataAttrs) {
      const val = $el.attr(attr);
      if (val && (looksLikeVideoUrl(val) || val.startsWith("http"))) {
        rawRefs.push({ url: val, sourceTag: `[${attr}]`, inferredExt: inferVideoExtFromUrl(val) });
      }
    }
  });

  // ─── Vturb (ConvertAI) video extraction ───
  // Vturb embeds load video URLs dynamically via player.js scripts.
  // We fetch those scripts and parse the actual video source URLs.
  try {
    const vturbVideos = await extractVturbVideos($, baseUrl, signal);
    for (const video of vturbVideos) {
      rawRefs.push({
        url: video.url,
        sourceTag: `vturb[${video.playerId}]`,
        inferredExt: inferVideoExtFromUrl(video.url),
      });
    }
  } catch {
    // Vturb extraction is best-effort — don't fail the whole extraction
  }

  const assets = await normalizeAndDeduplicate(rawRefs, baseUrl);

  // Extract links from the same parsed DOM (avoids double cheerio.load)
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) return;

    try {
      const u = new URL(resolved);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      u.hash = "";
      links.add(u.toString());
    } catch {}
  });

  return { assets, links: Array.from(links) };
}

// ─── CSS background-image helper ───

const CSS_BG_URL_PATTERN = /background(?:-image)?\s*:[^;]*url\(\s*["']?([^"')]+?)["']?\s*\)/gi;

function extractCssBackgroundUrls(css: string, refs: RawMediaRef[]): void {
  for (const match of css.matchAll(CSS_BG_URL_PATTERN)) {
    const url = match[1].trim();
    if (!url || url.startsWith("data:")) continue;
    refs.push({ url, sourceTag: "css[background-image]" });
  }
}

// ─── Video URL detection helpers ───

const VIDEO_URL_PATTERN =
  /https?:\/\/[^\s"'<>\])]+?\.(mp4|webm|mov|m4v|ogg|avi|mkv|flv|wmv|3gp|ts|f4v|mpg|mpeg|m3u8|mpd)(?:[?#][^\s"'<>\])]*)?/gi;

function looksLikeVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogg|avi|mkv|flv|wmv|3gp|ts|f4v|mpg|mpeg|m3u8|mpd)(\?|#|$)/i.test(url);
}

function inferVideoExtFromUrl(url: string): string | undefined {
  const match = url.match(/\.(mp4|webm|mov|m4v|ogg|avi|mkv|flv|wmv|3gp|ts|f4v|mpg|mpeg|m3u8|mpd)(\?|#|$)/i);
  return match ? match[1].toLowerCase() : undefined;
}

function extractVideoFromJsonLd(data: unknown, refs: RawMediaRef[]): void {
  if (!data || typeof data !== "object") return;

  if (Array.isArray(data)) {
    for (const item of data) extractVideoFromJsonLd(item, refs);
    return;
  }

  const obj = data as Record<string, unknown>;

  // Handle @graph arrays
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"]) extractVideoFromJsonLd(item, refs);
  }

  const type = String(obj["@type"] ?? "").toLowerCase();
  if (type === "videoobject" || type === "video") {
    for (const prop of ["contentUrl", "embedUrl", "url"]) {
      const val = obj[prop];
      if (typeof val === "string" && val.startsWith("http")) {
        // Skip YouTube/Vimeo embed URLs
        if (extractYouTubeId(val) || extractVimeoId(val)) continue;
        refs.push({ url: val, sourceTag: `json-ld[${prop}]`, inferredExt: inferVideoExtFromUrl(val) ?? "mp4" });
      }
    }
    // Also grab thumbnail
    const thumb = obj.thumbnailUrl;
    if (typeof thumb === "string" && thumb.startsWith("http")) {
      refs.push({ url: thumb, sourceTag: "json-ld[thumbnailUrl]" });
    }
  }
}

function extractVideoUrlsFromScript(script: string, refs: RawMediaRef[]): void {
  // 1. Find direct video URLs in any script content
  const urlMatches = script.matchAll(VIDEO_URL_PATTERN);
  for (const match of urlMatches) {
    const url = match[0];
    // Skip common false positives (source maps, imports, etc.)
    if (url.includes(".js.map") || url.includes("node_modules")) continue;
    refs.push({ url, sourceTag: "script", inferredExt: inferVideoExtFromUrl(url) });
  }

  // 2. JW Player config patterns: file:"url" or sources:[{file:"url"}]
  const jwPatterns = [
    /file\s*:\s*["']([^"']+?\.(mp4|webm|m3u8)[^"']*?)["']/gi,
    /source\s*:\s*["']([^"']+?\.(mp4|webm|m3u8)[^"']*?)["']/gi,
  ];
  for (const pattern of jwPatterns) {
    for (const m of script.matchAll(pattern)) {
      refs.push({ url: m[1], sourceTag: "script[jwplayer]", inferredExt: m[2].toLowerCase() });
    }
  }

  // 3. Video.js / HTML5 player patterns: src:"url" with video MIME
  const srcPatterns = /src\s*:\s*["']([^"']+?\.(mp4|webm|mov|ogg|m3u8)[^"']*?)["']/gi;
  for (const m of script.matchAll(srcPatterns)) {
    refs.push({ url: m[1], sourceTag: "script[player]", inferredExt: m[2].toLowerCase() });
  }

  // 4. JSON-like objects with video URLs: "url":"...mp4", "video_url":"...mp4"
  const jsonUrlPatterns =
    /["']((?:video_?)?(?:url|src|file|stream|source|hls|dash))["']\s*:\s*["'](https?:\/\/[^"']+?\.(mp4|webm|m3u8|mpd|mov|flv)[^"']*?)["']/gi;
  for (const m of script.matchAll(jsonUrlPatterns)) {
    refs.push({ url: m[2], sourceTag: `script[${m[1]}]`, inferredExt: m[3].toLowerCase() });
  }
}

// ─── Helpers ───

function resolveUrl(raw: string, base: string): string | null {
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

// ─── Deduplication ───

async function normalizeAndDeduplicate(refs: RawMediaRef[], baseUrl: string): Promise<MediaAsset[]> {
  const seen = new Set<string>();
  const assets: MediaAsset[] = [];

  for (const ref of refs) {
    const resolved = resolveUrl(ref.url, baseUrl);
    if (!resolved) continue;

    if (!isHttpUrl(resolved)) continue;

    // Deduplicate (strip fragment only, keep query params - they may identify distinct resources)
    const normalized = resolved.split("#")[0];
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // Try extension from URL first, fall back to inferred extension
    let ext = getExtensionFromUrl(resolved);
    let usedInferred = false;

    if ((!ext || !isMediaExtension(ext)) && ref.inferredExt) {
      ext = ref.inferredExt;
      usedInferred = true;
    }

    if (!ext || !isMediaExtension(ext)) continue;

    const type = classifyByExtension(ext);
    if (!type) continue;

    const fileName = sanitizeFileName(
      usedInferred ? `media-${assets.length + 1}.${ext}` : getFileNameFromUrl(resolved, assets.length),
      `media-${assets.length + 1}.${ext}`,
    );

    assets.push({
      url: resolved,
      type,
      fileName,
      extension: ext,
      sourceTag: ref.sourceTag,
    });

    if (assets.length >= appConfig.limits.maxAssets) break;
  }

  return assets;
}
