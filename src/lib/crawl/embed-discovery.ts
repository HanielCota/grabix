import type { CheerioAPI } from "cheerio";
import { extractVideoInfo } from "./platform-registry";
import type { EmbeddedMedia } from "./types";
import { resolveUrl } from "./url-utils";

const VIDEO_URL_PATTERN =
  /https?:\/\/[^\s"'<>\])]+?\.(mp4|webm|mov|m4v|ogg|avi|mkv|flv|wmv|3gp|ts|f4v|mpg|mpeg|m3u8|mpd)(?:[?#][^\s"'<>\])]*)?/gi;

const VIDEO_DATA_ATTRS = [
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
  "data-video-id",
  "data-youtube-id",
] as const;

/**
 * Discover embedded media in a parsed HTML document.
 * Finds videos in iframes, video tags, meta tags, JSON-LD, data attributes, and inline scripts.
 */
export function discoverEmbeds($: CheerioAPI, baseUrl: string): EmbeddedMedia[] {
  const results: EmbeddedMedia[] = [];
  const seen = new Set<string>();

  function addMedia(media: EmbeddedMedia) {
    const key = media.videoId ? `${media.platform}:${media.videoId}` : media.url;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(media);
  }

  extractIframes($, baseUrl, addMedia);
  extractVideoTags($, baseUrl, addMedia);
  extractEmbedAndObject($, baseUrl, addMedia);
  extractDataAttributes($, baseUrl, addMedia);
  extractOgMeta($, baseUrl, addMedia);
  extractTwitterMeta($, baseUrl, addMedia);
  extractJsonLd($, addMedia);
  extractInlineScripts($, addMedia);

  return results;
}

// ─── Iframe extraction ───

function extractIframes($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src");
    if (!src) return;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved) return;

    const info = extractVideoInfo(resolved);
    if (info) {
      add({
        url: resolved,
        type: "video",
        platform: info.platform,
        videoId: info.videoId,
        thumbnailUrl: info.thumbnailUrl,
        source: "iframe",
      });
      return;
    }

    // Direct video URL in iframe
    if (isDirectVideoUrl(resolved)) {
      add({
        url: resolved,
        type: "video",
        platform: "direct",
        videoId: null,
        thumbnailUrl: null,
        source: "iframe",
      });
    }
  });
}

// ─── Video tag extraction ───

function extractVideoTags($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  $("video").each((_, el) => {
    const $video = $(el);

    // Direct src on video tag
    const src = $video.attr("src") ?? $video.attr("data-src");
    if (src) {
      const resolved = resolveUrl(src, baseUrl);
      if (resolved) {
        add({
          url: resolved,
          type: "video",
          platform: "direct",
          videoId: null,
          thumbnailUrl: $video.attr("poster") ? resolveUrl($video.attr("poster") ?? "", baseUrl) : null,
          source: "video_tag",
        });
      }
    }

    // Source children
    $video.find("source").each((_, sourceEl) => {
      const sourceSrc = $(sourceEl).attr("src");
      if (!sourceSrc) return;
      const resolved = resolveUrl(sourceSrc, baseUrl);
      if (resolved) {
        add({
          url: resolved,
          type: "video",
          platform: "direct",
          videoId: null,
          thumbnailUrl: $video.attr("poster") ? resolveUrl($video.attr("poster") ?? "", baseUrl) : null,
          source: "video_tag",
        });
      }
    });

    // Poster as image
    const poster = $video.attr("poster");
    if (poster) {
      const resolved = resolveUrl(poster, baseUrl);
      if (resolved) {
        add({
          url: resolved,
          type: "image",
          platform: null,
          videoId: null,
          thumbnailUrl: null,
          source: "video_tag",
        });
      }
    }
  });
}

// ─── Embed and Object tags ───

function extractEmbedAndObject($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  $("embed[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    const resolved = resolveUrl(src, baseUrl);
    if (!resolved) return;

    const info = extractVideoInfo(resolved);
    if (info) {
      add({
        url: resolved,
        type: "video",
        platform: info.platform,
        videoId: info.videoId,
        thumbnailUrl: info.thumbnailUrl,
        source: "embed_tag",
      });
    } else if (isDirectVideoUrl(resolved)) {
      add({ url: resolved, type: "video", platform: "direct", videoId: null, thumbnailUrl: null, source: "embed_tag" });
    }
  });

  $("object[data]").each((_, el) => {
    const data = $(el).attr("data");
    if (!data) return;
    const resolved = resolveUrl(data, baseUrl);
    if (!resolved) return;

    const info = extractVideoInfo(resolved);
    if (info) {
      add({
        url: resolved,
        type: "video",
        platform: info.platform,
        videoId: info.videoId,
        thumbnailUrl: info.thumbnailUrl,
        source: "object_tag",
      });
    } else if (isDirectVideoUrl(resolved)) {
      add({
        url: resolved,
        type: "video",
        platform: "direct",
        videoId: null,
        thumbnailUrl: null,
        source: "object_tag",
      });
    }
  });
}

// ─── Data attributes ───

function extractDataAttributes($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  const selector = VIDEO_DATA_ATTRS.map((a) => `[${a}]`).join(", ");

  $(selector).each((_, el) => {
    const $el = $(el);

    for (const attr of VIDEO_DATA_ATTRS) {
      const val = $el.attr(attr);
      if (!val) continue;

      // data-video-id / data-youtube-id: these are IDs, not URLs
      if (attr === "data-video-id" || attr === "data-youtube-id") {
        // Try to build a YouTube URL from the ID
        if (attr === "data-youtube-id" || ($el.attr("class")?.includes("youtube") ?? false)) {
          add({
            url: `https://www.youtube.com/watch?v=${val}`,
            type: "video",
            platform: "youtube",
            videoId: val,
            thumbnailUrl: `https://img.youtube.com/vi/${val}/mqdefault.jpg`,
            source: "data_attr",
          });
        }
        continue;
      }

      const resolved = resolveUrl(val, baseUrl);
      if (!resolved) continue;

      const info = extractVideoInfo(resolved);
      if (info) {
        add({
          url: resolved,
          type: "video",
          platform: info.platform,
          videoId: info.videoId,
          thumbnailUrl: info.thumbnailUrl,
          source: "data_attr",
        });
      } else if (isDirectVideoUrl(resolved) || val.startsWith("http")) {
        add({
          url: resolved,
          type: "video",
          platform: "direct",
          videoId: null,
          thumbnailUrl: null,
          source: "data_attr",
        });
      }
    }
  });
}

// ─── Open Graph meta ───

function extractOgMeta($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  const ogVideoProps = ["og:video", "og:video:url", "og:video:secure_url"];

  for (const prop of ogVideoProps) {
    const content = $(`meta[property="${prop}"]`).attr("content") ?? $(`meta[name="${prop}"]`).attr("content");
    if (!content) continue;

    const resolved = resolveUrl(content, baseUrl);
    if (!resolved) continue;

    const info = extractVideoInfo(resolved);
    if (info) {
      add({
        url: resolved,
        type: "video",
        platform: info.platform,
        videoId: info.videoId,
        thumbnailUrl: info.thumbnailUrl,
        source: "og_meta",
      });
    } else if (isDirectVideoUrl(resolved)) {
      add({ url: resolved, type: "video", platform: "direct", videoId: null, thumbnailUrl: null, source: "og_meta" });
    }
  }
}

// ─── Twitter Card meta ───

function extractTwitterMeta($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  const twitterProps = ["twitter:player", "twitter:player:stream"];

  for (const prop of twitterProps) {
    const content = $(`meta[name="${prop}"]`).attr("content") ?? $(`meta[property="${prop}"]`).attr("content");
    if (!content) continue;

    const resolved = resolveUrl(content, baseUrl);
    if (!resolved) continue;

    const info = extractVideoInfo(resolved);
    if (info) {
      add({
        url: resolved,
        type: "video",
        platform: info.platform,
        videoId: info.videoId,
        thumbnailUrl: info.thumbnailUrl,
        source: "twitter_meta",
      });
    } else if (isDirectVideoUrl(resolved)) {
      add({
        url: resolved,
        type: "video",
        platform: "direct",
        videoId: null,
        thumbnailUrl: null,
        source: "twitter_meta",
      });
    }
  }
}

// ─── JSON-LD structured data ───

function extractJsonLd($: CheerioAPI, add: (m: EmbeddedMedia) => void) {
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).html();
    if (!text) return;

    try {
      const data = JSON.parse(text);
      processJsonLdNode(data, add);
    } catch {
      // Malformed JSON-LD — skip
    }
  });
}

function processJsonLdNode(data: unknown, add: (m: EmbeddedMedia) => void): void {
  if (!data || typeof data !== "object") return;

  if (Array.isArray(data)) {
    for (const item of data) processJsonLdNode(item, add);
    return;
  }

  const obj = data as Record<string, unknown>;

  // Handle @graph
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"]) processJsonLdNode(item, add);
  }

  const type = String(obj["@type"] ?? "").toLowerCase();
  if (type !== "videoobject" && type !== "video") return;

  for (const prop of ["contentUrl", "embedUrl", "url"]) {
    const val = obj[prop];
    if (typeof val !== "string" || !val.startsWith("http")) continue;

    const info = extractVideoInfo(val);
    if (info) {
      add({
        url: val,
        type: "video",
        platform: info.platform,
        videoId: info.videoId,
        thumbnailUrl: info.thumbnailUrl,
        source: "json_ld",
      });
    } else if (isDirectVideoUrl(val)) {
      add({ url: val, type: "video", platform: "direct", videoId: null, thumbnailUrl: null, source: "json_ld" });
    }
  }

  // Thumbnail
  const thumb = obj.thumbnailUrl;
  if (typeof thumb === "string" && thumb.startsWith("http")) {
    add({ url: thumb, type: "image", platform: null, videoId: null, thumbnailUrl: null, source: "json_ld" });
  }
}

// ─── Inline scripts ───
// Only extract DIRECT video file URLs (.mp4, .webm, etc.) from scripts.
// We intentionally do NOT extract platform URLs (youtube.com, vimeo.com)
// from scripts because they overwhelmingly come from recommendation engines,
// analytics, ads, and player playlist configs — not from the page's own content.
// Platform videos are already captured via iframes, og:video, JSON-LD, and <a> links.

function extractInlineScripts($: CheerioAPI, add: (m: EmbeddedMedia) => void) {
  $("script:not([src])").each((_, el) => {
    const text = $(el).html();
    if (!text || text.length > 500_000) return;

    // Only find direct video file URLs (not platform embed URLs)
    for (const match of text.matchAll(VIDEO_URL_PATTERN)) {
      const url = cleanScriptUrl(match[0]);
      if (url.includes(".js.map") || url.includes("node_modules")) continue;
      add({ url, type: "video", platform: "direct", videoId: null, thumbnailUrl: null, source: "inline_script" });
    }
  });
}

// ─── Helpers ───

function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogg|avi|mkv|flv|wmv|3gp|ts|f4v|mpg|mpeg|m3u8|mpd)(\?|#|$)/i.test(url);
}

function cleanScriptUrl(url: string): string {
  // Remove trailing punctuation that might have been captured
  return url.replace(/[;,'")\]}>]+$/, "");
}
