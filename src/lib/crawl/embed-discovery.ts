import type { CheerioAPI } from "cheerio";
import { isHttpUrl } from "@/lib/url/public-url";
import { extractVideoInfo } from "./platform-registry";
import type { EmbeddedMedia } from "./types";
import { resolveUrl } from "./url-utils";

const VIDEO_URL_PATTERN =
  /https?:\/\/[^\s"'<>\])]+?\.(mp4|webm|mov|m4v|ogg|avi|mkv|flv|wmv|3gp|ts|f4v|mpg|mpeg|m3u8|mpd)(?:[?#][^\s"'<>\])]*)?/gi;

const PLATFORM_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^\s"'<>]+|embed\/[^\s"'<>]+|shorts\/[^\s"'<>]+|live\/[^\s"'<>]+|clip\/[^\s"'<>]+|playlist\?[^\s"'<>]+|@[\w.-]+|channel\/[^\s"'<>]+)|youtu\.be\/[^\s"'<>]+|vimeo\.com\/[^\s"'<>]+|player\.vimeo\.com\/video\/[^\s"'<>]+|holodex\.net\/(?:watch|channel|multiview)\/[^\s"'<>]+|scripts\.converteai\.net\/[^\s"'<>]+)/gi;

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
  "data-youtube-url",
  "data-embed-url",
  "data-vimeo-url",
  "data-player-url",
  "data-vturb-url",
];

const STRUCTURED_SCRIPT_HINT_PATTERN =
  /(youtube_url|vimeo_url|video_url|embed_url|converteai|vturb|smartplayer|__NEXT_DATA__|__NUXT__|elementor)/i;

export function discoverEmbeds($: CheerioAPI, baseUrl: string): EmbeddedMedia[] {
  const results: EmbeddedMedia[] = [];
  const seen = new Set<string>();

  function addMedia(media: EmbeddedMedia) {
    const key = media.canonicalUrl ?? (media.videoId ? `${media.platform}:${media.videoId}` : media.url);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(media);
  }

  extractIframes($, baseUrl, addMedia);
  extractVideoTags($, baseUrl, addMedia);
  extractEmbedAndObject($, baseUrl, addMedia);
  extractElementorVideoWidgets($, baseUrl, addMedia);
  extractLightPlayerElements($, addMedia);
  extractDataAttributes($, baseUrl, addMedia);
  extractOgMeta($, baseUrl, addMedia);
  extractTwitterMeta($, baseUrl, addMedia);
  extractJsonLd($, addMedia);
  extractStructuredInlinePlayers($, addMedia);
  extractInlineScripts($, addMedia);

  return results;
}

function extractIframes($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src") ?? $(el).attr("data-lazy-src");
    if (!src) return;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || !isHttpUrl(resolved)) return;

    const info = extractVideoInfo(resolved);
    if (info) {
      add(platformMedia(resolved, info, "iframe", "iframe-embed"));
      return;
    }

    if (isDirectVideoUrl(resolved)) {
      add(directVideo(resolved, "iframe", "direct-iframe"));
    }
  });
}

function extractVideoTags($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  $("video").each((_, el) => {
    const $video = $(el);
    const poster = $video.attr("poster");
    const resolvedPoster = poster ? resolveUrl(poster, baseUrl) : null;

    const src = $video.attr("src") ?? $video.attr("data-src");
    if (src) {
      const resolved = resolveUrl(src, baseUrl);
      if (resolved && isHttpUrl(resolved)) {
        add({
          ...directVideo(resolved, "video_tag", "html5-video"),
          thumbnailUrl: resolvedPoster && isHttpUrl(resolvedPoster) ? resolvedPoster : null,
        });
      }
    }

    $video.find("source").each((_, sourceEl) => {
      const sourceSrc = $(sourceEl).attr("src") ?? $(sourceEl).attr("data-src");
      if (!sourceSrc) return;
      const resolved = resolveUrl(sourceSrc, baseUrl);
      if (resolved && isHttpUrl(resolved)) {
        add({
          ...directVideo(resolved, "video_tag", "html5-video-source"),
          thumbnailUrl: resolvedPoster && isHttpUrl(resolvedPoster) ? resolvedPoster : null,
        });
      }
    });

    if (resolvedPoster && isHttpUrl(resolvedPoster)) {
      add(imageMedia(resolvedPoster, "video_tag", "video-poster"));
    }
  });
}

function extractEmbedAndObject($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  $("embed[src], object[data]").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") ?? $el.attr("data");
    if (!src) return;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || !isHttpUrl(resolved)) return;

    const info = extractVideoInfo(resolved);
    if (info) {
      add(platformMedia(resolved, info, $el.is("embed") ? "embed_tag" : "object_tag", "object-embed"));
      return;
    }

    if (isDirectVideoUrl(resolved)) {
      add(directVideo(resolved, $el.is("embed") ? "embed_tag" : "object_tag", "direct-embed"));
    }
  });
}

function extractElementorVideoWidgets($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  $(".elementor-widget-video[data-settings], [data-widget_type='video.default'][data-settings]").each((_, el) => {
    const raw = $(el).attr("data-settings");
    if (!raw) return;

    const settings = parseHtmlJson(raw);
    if (!settings || typeof settings !== "object") return;

    const urls = collectSettingsUrls(settings);
    for (const url of urls) {
      const resolved = resolveUrl(url, baseUrl);
      if (!resolved || !isHttpUrl(resolved)) continue;

      const info = extractVideoInfo(resolved);
      if (info) {
        add({
          ...platformMedia(resolved, info, "data_attr", "elementor-video-widget"),
          confidence: Math.max(info.confidence, 0.94),
        });
      } else if (isDirectVideoUrl(resolved)) {
        add(directVideo(resolved, "data_attr", "elementor-video-widget"));
      }
    }
  });
}

function extractLightPlayerElements($: CheerioAPI, add: (m: EmbeddedMedia) => void) {
  $("amp-youtube[data-videoid], lite-youtube[videoid], [data-youtube-id], [class*='youtube'][data-video-id]").each(
    (_, el) => {
      const $el = $(el);
      const videoId =
        $el.attr("data-videoid") ?? $el.attr("videoid") ?? $el.attr("data-youtube-id") ?? $el.attr("data-video-id");
      if (!videoId) return;

      const info = extractVideoInfo(`https://www.youtube.com/watch?v=${videoId}`);
      if (!info) return;
      add({
        ...platformMedia(info.canonicalUrl, info, "data_attr", "light-youtube-player"),
        confidence: Math.max(info.confidence, 0.92),
      });
    },
  );

  $("amp-vimeo[data-videoid]").each((_, el) => {
    const videoId = $(el).attr("data-videoid");
    if (!videoId) return;

    const info = extractVideoInfo(`https://player.vimeo.com/video/${videoId}`);
    if (!info) return;
    add({
      ...platformMedia(info.canonicalUrl, info, "data_attr", "light-vimeo-player"),
      confidence: Math.max(info.confidence, 0.9),
    });
  });
}

function extractDataAttributes($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  const selector = VIDEO_DATA_ATTRS.map((attr) => `[${attr}]`).join(", ");

  $(selector).each((_, el) => {
    const $el = $(el);

    for (const attr of VIDEO_DATA_ATTRS) {
      const value = $el.attr(attr);
      if (!value) continue;

      if (attr === "data-video-id" || attr === "data-youtube-id") {
        const info = extractVideoInfo(`https://www.youtube.com/watch?v=${value}`);
        if (info) {
          add({
            ...platformMedia(info.canonicalUrl, info, "data_attr", "youtube-id-attribute"),
            confidence: Math.max(info.confidence, 0.9),
          });
        }
        continue;
      }

      const resolved = resolveUrl(value, baseUrl);
      if (!resolved || !isHttpUrl(resolved)) continue;

      const info = extractVideoInfo(resolved);
      if (info) {
        add(platformMedia(resolved, info, "data_attr", "media-attribute"));
      } else if (isDirectVideoUrl(resolved)) {
        add(directVideo(resolved, "data_attr", "media-attribute"));
      }
    }
  });
}

function extractOgMeta($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  const properties = ["og:video", "og:video:url", "og:video:secure_url", "og:image"];

  for (const prop of properties) {
    const content = $(`meta[property="${prop}"]`).attr("content") ?? $(`meta[name="${prop}"]`).attr("content");
    if (!content) continue;

    const resolved = resolveUrl(content, baseUrl);
    if (!resolved || !isHttpUrl(resolved)) continue;

    if (prop === "og:image") {
      add(imageMedia(resolved, "og_meta", "og-image"));
      continue;
    }

    const info = extractVideoInfo(resolved);
    if (info) {
      add(platformMedia(resolved, info, "og_meta", "og-video"));
    } else if (isDirectVideoUrl(resolved)) {
      add(directVideo(resolved, "og_meta", "og-video"));
    }
  }
}

function extractTwitterMeta($: CheerioAPI, baseUrl: string, add: (m: EmbeddedMedia) => void) {
  const props = ["twitter:player", "twitter:player:stream"];

  for (const prop of props) {
    const content = $(`meta[name="${prop}"]`).attr("content") ?? $(`meta[property="${prop}"]`).attr("content");
    if (!content) continue;

    const resolved = resolveUrl(content, baseUrl);
    if (!resolved || !isHttpUrl(resolved)) continue;

    const info = extractVideoInfo(resolved);
    if (info) {
      add(platformMedia(resolved, info, "twitter_meta", "twitter-card"));
    } else if (isDirectVideoUrl(resolved)) {
      add(directVideo(resolved, "twitter_meta", "twitter-card"));
    }
  }
}

function extractJsonLd($: CheerioAPI, add: (m: EmbeddedMedia) => void) {
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).html();
    if (!text) return;

    try {
      const data = JSON.parse(text);
      processJsonLdNode(data, add);
    } catch {
      // Ignore malformed JSON-LD blocks.
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
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"]) processJsonLdNode(item, add);
  }

  const type = String(obj["@type"] ?? "").toLowerCase();
  if (type !== "videoobject" && type !== "video") return;

  for (const prop of ["contentUrl", "embedUrl", "url"]) {
    const value = obj[prop];
    if (typeof value !== "string" || !isHttpUrl(value)) continue;

    const info = extractVideoInfo(value);
    if (info) {
      add({
        ...platformMedia(value, info, "json_ld", "json-ld-video"),
        confidence: Math.max(info.confidence, 0.96),
      });
    } else if (isDirectVideoUrl(value)) {
      add(directVideo(value, "json_ld", "json-ld-video"));
    }
  }

  const thumbnail = obj.thumbnailUrl;
  if (typeof thumbnail === "string" && isHttpUrl(thumbnail)) {
    add(imageMedia(thumbnail, "json_ld", "json-ld-thumbnail"));
  }
}

function extractStructuredInlinePlayers($: CheerioAPI, add: (m: EmbeddedMedia) => void) {
  $("script:not([src])").each((_, el) => {
    const text = $(el).html();
    if (!text || text.length > 500_000 || !STRUCTURED_SCRIPT_HINT_PATTERN.test(text)) return;

    for (const match of text.matchAll(PLATFORM_URL_PATTERN)) {
      const url = cleanScriptUrl(match[0]);
      const info = extractVideoInfo(url);
      if (!info) continue;

      add({
        ...platformMedia(info.canonicalUrl, info, "inline_script", "structured-player-state"),
        confidence: Math.max(info.confidence, 0.82),
      });
    }
  });

  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src?.includes("converteai")) return;

    const info = extractVideoInfo(src);
    if (!info) return;

    add({
      ...platformMedia(info.canonicalUrl, info, "inline_script", "vturb-player-script"),
      confidence: Math.max(info.confidence, 0.86),
    });
  });
}

function extractInlineScripts($: CheerioAPI, add: (m: EmbeddedMedia) => void) {
  $("script:not([src])").each((_, el) => {
    const text = $(el).html();
    if (!text || text.length > 500_000) return;

    for (const match of text.matchAll(VIDEO_URL_PATTERN)) {
      const url = cleanScriptUrl(match[0]);
      if (url.includes(".js.map") || url.includes("node_modules") || !isHttpUrl(url)) continue;
      add(directVideo(url, "inline_script", "inline-direct-video"));
    }
  });
}

function platformMedia(
  url: string,
  info: NonNullable<ReturnType<typeof extractVideoInfo>>,
  source: EmbeddedMedia["source"],
  discoveryReason: string,
): EmbeddedMedia {
  return {
    url,
    type: "video",
    platform: info.platform,
    videoId: info.videoId,
    thumbnailUrl: info.thumbnailUrl,
    canonicalUrl: info.canonicalUrl,
    contentKind: info.kind,
    confidence: info.confidence,
    source,
    downloadable: false,
    discoveryReason,
  };
}

function directVideo(url: string, source: EmbeddedMedia["source"], discoveryReason: string): EmbeddedMedia {
  return {
    url,
    type: "video",
    platform: "direct",
    videoId: null,
    thumbnailUrl: null,
    canonicalUrl: url,
    contentKind: "video",
    confidence: 0.92,
    source,
    downloadable: true,
    discoveryReason,
  };
}

function imageMedia(url: string, source: EmbeddedMedia["source"], discoveryReason: string): EmbeddedMedia {
  return {
    url,
    type: "image",
    platform: null,
    videoId: null,
    thumbnailUrl: null,
    canonicalUrl: url,
    contentKind: null,
    confidence: 0.9,
    source,
    downloadable: true,
    discoveryReason,
  };
}

function parseHtmlJson(raw: string): unknown | null {
  try {
    return JSON.parse(
      raw
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&"),
    );
  } catch {
    return null;
  }
}

function collectSettingsUrls(value: unknown, path = "", depth = 0): string[] {
  if (depth > 5 || value == null) return [];

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (/(?:^|\.)(?:youtube_url|vimeo_url|external_url|watch_url|embed_url|video_url|url|hosted_url)$/i.test(path)) {
      return [trimmed];
    }
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectSettingsUrls(entry, `${path}[${index}]`, depth + 1));
  }

  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => {
      const nextPath = path ? `${path}.${key}` : key;
      return collectSettingsUrls(nested, nextPath, depth + 1);
    });
  }

  return [];
}

function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogg|avi|mkv|flv|wmv|3gp|ts|f4v|mpg|mpeg|m3u8|mpd)(\?|#|$)/i.test(url);
}

function cleanScriptUrl(url: string): string {
  return url.replace(/[;,'")\]}>]+$/, "");
}
