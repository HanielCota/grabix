import * as cheerio from "cheerio";
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

export async function extractMediaFromHtml(html: string, baseUrl: string): Promise<MediaAsset[]> {
  const result = await extractMediaAndLinks(html, baseUrl);
  return result.assets;
}

export async function extractMediaAndLinks(html: string, baseUrl: string): Promise<ExtractionResult> {
  const $ = cheerio.load(html);
  const rawRefs: RawMediaRef[] = [];

  // img - all lazy-load variants + srcset
  $("img").each((_, el) => {
    const $el = $(el);
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

  // source[src] + lazy variants (with MIME-based type inference)
  $("source").each((_, el) => {
    const $el = $(el);
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

  const metaVideoAttrs = ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"];

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

    // Skip data URIs
    if (resolved.startsWith("data:")) continue;

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

    const fileName = usedInferred ? `media-${assets.length + 1}.${ext}` : getFileNameFromUrl(resolved, assets.length);

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
