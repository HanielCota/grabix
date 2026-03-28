import * as cheerio from "cheerio";
import { appConfig } from "@/server/config";
import {
  classifyByExtension,
  getExtensionFromUrl,
  getFileNameFromUrl,
  isMediaExtension,
} from "../domain/media-extensions";
import type { MediaAsset } from "../domain/types";

interface RawMediaRef {
  url: string;
  sourceTag: string;
}

// Common lazy-load attributes used by WP Rocket, lazysizes, native lazy, etc.
const LAZY_SRC_ATTRS = ["src", "data-src", "data-lazy-src", "data-original", "data-bg"];

const LAZY_SRCSET_ATTRS = ["srcset", "data-srcset", "data-lazy-srcset"];

type CheerioEl = ReturnType<ReturnType<typeof cheerio.load>>;

function pushAttr(el: CheerioEl, attr: string, tag: string, refs: RawMediaRef[]) {
  const val = el.attr(attr);
  if (val) refs.push({ url: val, sourceTag: `${tag}[${attr}]` });
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

export async function extractMediaFromHtml(html: string, baseUrl: string): Promise<MediaAsset[]> {
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

  // video[src] + lazy variants
  $("video").each((_, el) => {
    const $el = $(el);
    for (const attr of LAZY_SRC_ATTRS) {
      pushAttr($el, attr, "video", rawRefs);
    }
  });

  // source[src] + lazy variants
  $("source").each((_, el) => {
    const $el = $(el);
    for (const attr of LAZY_SRC_ATTRS) {
      pushAttr($el, attr, "source", rawRefs);
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

  return await normalizeAndDeduplicate(rawRefs, baseUrl);
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

    // Check extension
    const ext = getExtensionFromUrl(resolved);
    if (!ext || !isMediaExtension(ext)) continue;

    const type = classifyByExtension(ext);
    if (!type) continue;

    assets.push({
      url: resolved,
      type,
      fileName: getFileNameFromUrl(resolved, assets.length),
      extension: ext,
      sourceTag: ref.sourceTag,
    });

    if (assets.length >= appConfig.limits.maxAssets) break;
  }

  return assets;
}
