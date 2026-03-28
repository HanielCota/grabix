import type { VideoInfo, VideoPlatform } from "./types";

// ─── Platform Definitions ───

const youtube: VideoPlatform = {
  name: "youtube",
  patterns: [
    /(?:www\.)?youtube\.com\/watch\?/,
    /youtu\.be\//,
    /(?:www\.)?youtube\.com\/embed\//,
    /(?:www\.)?youtube\.com\/shorts\//,
    /(?:www\.)?youtube-nocookie\.com\/embed\//,
  ],
  extractVideoId(url: string): string | null {
    try {
      const normalized = url.startsWith("//") ? `https:${url}` : url;
      const u = new URL(normalized);
      const host = u.hostname.replace(/^www\./, "");

      if (host === "youtu.be") {
        return u.pathname.slice(1).split("/")[0] || null;
      }
      if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (u.pathname.startsWith("/embed/") || u.pathname.startsWith("/shorts/")) {
          return u.pathname.split("/")[2] || null;
        }
        if (u.searchParams.has("v")) {
          return u.searchParams.get("v") || null;
        }
      }
    } catch {
      /* invalid URL */
    }
    return null;
  },
  getThumbnailUrl(videoId: string): string {
    return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  },
};

const vimeo: VideoPlatform = {
  name: "vimeo",
  patterns: [/(?:www\.)?vimeo\.com\/\d+/, /player\.vimeo\.com\/video\/\d+/],
  extractVideoId(url: string): string | null {
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
    } catch {
      /* invalid URL */
    }
    return null;
  },
  getThumbnailUrl(videoId: string): string {
    return `https://vumbnail.com/${videoId}.jpg`;
  },
};

const dailymotion: VideoPlatform = {
  name: "dailymotion",
  patterns: [/(?:www\.)?dailymotion\.com\/video\//, /dai\.ly\//],
  extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (host === "dai.ly") {
        return u.pathname.slice(1).split("/")[0] || null;
      }
      if (host === "dailymotion.com" && u.pathname.startsWith("/video/")) {
        const segment = u.pathname.split("/")[2];
        return segment?.split("_")[0] || null;
      }
    } catch {
      /* invalid URL */
    }
    return null;
  },
  getThumbnailUrl(videoId: string): string {
    return `https://www.dailymotion.com/thumbnail/video/${videoId}`;
  },
};

const twitch: VideoPlatform = {
  name: "twitch",
  patterns: [/(?:www\.)?twitch\.tv\/videos\//, /clips\.twitch\.tv\//],
  extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (host === "twitch.tv" && u.pathname.startsWith("/videos/")) {
        return u.pathname.split("/")[2] || null;
      }
      if (host === "clips.twitch.tv") {
        return u.pathname.slice(1).split("/")[0] || null;
      }
    } catch {
      /* invalid URL */
    }
    return null;
  },
};

const twitter: VideoPlatform = {
  name: "twitter",
  patterns: [/(?:www\.)?twitter\.com\/[^/]+\/status\//, /(?:www\.)?x\.com\/[^/]+\/status\//],
  extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      const match = u.pathname.match(/\/status\/(\d+)/);
      return match?.[1] ?? null;
    } catch {
      /* invalid URL */
    }
    return null;
  },
};

const tiktok: VideoPlatform = {
  name: "tiktok",
  patterns: [/(?:www\.)?tiktok\.com\/@[^/]+\/video\//],
  extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      const match = u.pathname.match(/\/video\/(\d+)/);
      return match?.[1] ?? null;
    } catch {
      /* invalid URL */
    }
    return null;
  },
};

const instagram: VideoPlatform = {
  name: "instagram",
  patterns: [/(?:www\.)?instagram\.com\/reel\//, /(?:www\.)?instagram\.com\/p\//],
  extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      const match = u.pathname.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
      return match?.[1] ?? null;
    } catch {
      /* invalid URL */
    }
    return null;
  },
};

const holodex: VideoPlatform = {
  name: "holodex",
  patterns: [/(?:www\.)?holodex\.net\/watch\//],
  extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.pathname.startsWith("/watch/")) {
        return u.pathname.split("/")[2] || null;
      }
    } catch {
      /* invalid URL */
    }
    return null;
  },
};

const bilibili: VideoPlatform = {
  name: "bilibili",
  patterns: [/(?:www\.)?bilibili\.com\/video\//, /b23\.tv\//],
  extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (host === "b23.tv") {
        return u.pathname.slice(1).split("/")[0] || null;
      }
      if (host === "bilibili.com" && u.pathname.startsWith("/video/")) {
        return u.pathname.split("/")[2]?.replace(/\/$/, "") || null;
      }
    } catch {
      /* invalid URL */
    }
    return null;
  },
};

const niconico: VideoPlatform = {
  name: "niconico",
  patterns: [/(?:www\.)?nicovideo\.jp\/watch\//],
  extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.pathname.startsWith("/watch/")) {
        return u.pathname.split("/")[2] || null;
      }
    } catch {
      /* invalid URL */
    }
    return null;
  },
};

// ─── Registry ───

const platforms: VideoPlatform[] = [
  youtube,
  vimeo,
  dailymotion,
  twitch,
  twitter,
  tiktok,
  instagram,
  holodex,
  bilibili,
  niconico,
];

// Domains that belong to known video platforms — any page on these
// should be treated as a media source, not crawled for sub-links.
const VIDEO_PLATFORM_DOMAINS = new Set([
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "vimeo.com",
  "player.vimeo.com",
  "dailymotion.com",
  "dai.ly",
  "twitch.tv",
  "clips.twitch.tv",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "instagram.com",
  "holodex.net",
  "bilibili.com",
  "b23.tv",
  "nicovideo.jp",
]);

/**
 * Check if a URL matches a known video platform pattern (e.g. youtube.com/watch?v=...).
 */
export function isVideoPlatformUrl(url: string): boolean {
  return platforms.some((p) => p.patterns.some((re) => re.test(url)));
}

/**
 * Check if a URL's domain belongs to a known video platform.
 * Used to prevent crawling into platform sites (following internal links on youtube.com, etc.)
 */
export function isVideoPlatformDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return VIDEO_PLATFORM_DOMAINS.has(host);
  } catch {
    return false;
  }
}

/**
 * Identify which video platform a URL belongs to.
 */
export function identifyPlatform(url: string): VideoPlatform | null {
  return platforms.find((p) => p.patterns.some((re) => re.test(url))) ?? null;
}

/**
 * Extract video info (platform, videoId, thumbnailUrl) from a URL.
 */
export function extractVideoInfo(url: string): VideoInfo | null {
  const platform = identifyPlatform(url);
  if (!platform) return null;

  const videoId = platform.extractVideoId(url);
  if (!videoId) return null;

  return {
    platform: platform.name,
    videoId,
    thumbnailUrl: platform.getThumbnailUrl?.(videoId) ?? null,
  };
}
