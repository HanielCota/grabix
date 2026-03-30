import type { MediaContentKind, VideoInfo, VideoPlatform } from "./types";

function normalizeUrl(input: string): URL | null {
  try {
    return new URL(input.startsWith("//") ? `https:${input}` : input);
  } catch {
    return null;
  }
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase();
}

function getPathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function createVideoInfo({
  platform,
  videoId,
  canonicalUrl,
  kind,
  thumbnailUrl = null,
  confidence,
}: {
  platform: string;
  videoId: string;
  canonicalUrl: string;
  kind: MediaContentKind;
  thumbnailUrl?: string | null;
  confidence: number;
}): VideoInfo {
  return {
    platform,
    videoId,
    canonicalUrl,
    kind,
    thumbnailUrl,
    confidence,
  };
}

function youtubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

const youtube: VideoPlatform = {
  name: "youtube",
  domains: ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"],
  match(url) {
    const host = normalizeHost(url.hostname);
    const segments = getPathSegments(url);

    if (host === "youtu.be") {
      const videoId = segments[0];
      if (!videoId) return null;
      return createVideoInfo({
        platform: "youtube",
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        kind: "video",
        thumbnailUrl: youtubeThumbnail(videoId),
        confidence: 0.99,
      });
    }

    if (!this.domains.includes(host)) {
      return null;
    }

    if (segments[0] === "shorts" && segments[1]) {
      const videoId = segments[1];
      return createVideoInfo({
        platform: "youtube",
        videoId,
        canonicalUrl: `https://www.youtube.com/shorts/${videoId}`,
        kind: "short",
        thumbnailUrl: youtubeThumbnail(videoId),
        confidence: 0.98,
      });
    }

    if (segments[0] === "live" && segments[1]) {
      const videoId = segments[1];
      return createVideoInfo({
        platform: "youtube",
        videoId,
        canonicalUrl: `https://www.youtube.com/live/${videoId}`,
        kind: "live",
        thumbnailUrl: youtubeThumbnail(videoId),
        confidence: 0.97,
      });
    }

    if (segments[0] === "clip" && segments[1]) {
      const clipId = segments[1];
      return createVideoInfo({
        platform: "youtube",
        videoId: clipId,
        canonicalUrl: `https://www.youtube.com/clip/${clipId}`,
        kind: "clip",
        confidence: 0.94,
      });
    }

    if (segments[0] === "embed" && segments[1]) {
      const videoId = segments[1];
      return createVideoInfo({
        platform: "youtube",
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        kind: "video",
        thumbnailUrl: youtubeThumbnail(videoId),
        confidence: 0.97,
      });
    }

    const videoId = url.searchParams.get("v");
    if (videoId) {
      return createVideoInfo({
        platform: "youtube",
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        kind: "video",
        thumbnailUrl: youtubeThumbnail(videoId),
        confidence: 0.98,
      });
    }

    const listId = url.searchParams.get("list");
    if (listId && (segments[0] === "playlist" || segments[0] === "watch")) {
      return createVideoInfo({
        platform: "youtube",
        videoId: listId,
        canonicalUrl: `https://www.youtube.com/playlist?list=${listId}`,
        kind: "playlist",
        confidence: 0.88,
      });
    }

    if (segments[0]?.startsWith("@")) {
      const channelId = segments[0];
      return createVideoInfo({
        platform: "youtube",
        videoId: channelId,
        canonicalUrl: `https://www.youtube.com/${channelId}`,
        kind: "channel",
        confidence: 0.85,
      });
    }

    if (segments[0] === "channel" && segments[1]) {
      const channelId = segments[1];
      return createVideoInfo({
        platform: "youtube",
        videoId: channelId,
        canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
        kind: "channel",
        confidence: 0.85,
      });
    }

    return null;
  },
};

const vimeo: VideoPlatform = {
  name: "vimeo",
  domains: ["vimeo.com", "player.vimeo.com"],
  match(url) {
    const host = normalizeHost(url.hostname);
    const segments = getPathSegments(url);

    if (host === "player.vimeo.com" && segments[0] === "video" && segments[1]) {
      const videoId = segments[1];
      return createVideoInfo({
        platform: "vimeo",
        videoId,
        canonicalUrl: `https://vimeo.com/${videoId}`,
        kind: "video",
        thumbnailUrl: `https://vumbnail.com/${videoId}.jpg`,
        confidence: 0.97,
      });
    }

    if (host === "vimeo.com" && /^\d+$/.test(segments[0] ?? "")) {
      const videoId = segments[0];
      return createVideoInfo({
        platform: "vimeo",
        videoId,
        canonicalUrl: `https://vimeo.com/${videoId}`,
        kind: "video",
        thumbnailUrl: `https://vumbnail.com/${videoId}.jpg`,
        confidence: 0.96,
      });
    }

    return null;
  },
};

const dailymotion: VideoPlatform = {
  name: "dailymotion",
  domains: ["dailymotion.com", "dai.ly"],
  match(url) {
    const host = normalizeHost(url.hostname);
    const segments = getPathSegments(url);

    if (host === "dai.ly" && segments[0]) {
      const videoId = segments[0];
      return createVideoInfo({
        platform: "dailymotion",
        videoId,
        canonicalUrl: `https://www.dailymotion.com/video/${videoId}`,
        kind: "video",
        thumbnailUrl: `https://www.dailymotion.com/thumbnail/video/${videoId}`,
        confidence: 0.96,
      });
    }

    if (host === "dailymotion.com" && segments[0] === "video" && segments[1]) {
      const videoId = segments[1].split("_")[0];
      if (!videoId) return null;
      return createVideoInfo({
        platform: "dailymotion",
        videoId,
        canonicalUrl: `https://www.dailymotion.com/video/${videoId}`,
        kind: "video",
        thumbnailUrl: `https://www.dailymotion.com/thumbnail/video/${videoId}`,
        confidence: 0.95,
      });
    }

    return null;
  },
};

const twitch: VideoPlatform = {
  name: "twitch",
  domains: ["twitch.tv", "clips.twitch.tv"],
  match(url) {
    const host = normalizeHost(url.hostname);
    const segments = getPathSegments(url);

    if (host === "clips.twitch.tv" && segments[0]) {
      return createVideoInfo({
        platform: "twitch",
        videoId: segments[0],
        canonicalUrl: `https://clips.twitch.tv/${segments[0]}`,
        kind: "clip",
        confidence: 0.95,
      });
    }

    if (host === "twitch.tv" && segments[0] === "videos" && segments[1]) {
      return createVideoInfo({
        platform: "twitch",
        videoId: segments[1],
        canonicalUrl: `https://www.twitch.tv/videos/${segments[1]}`,
        kind: "video",
        confidence: 0.95,
      });
    }

    return null;
  },
};

const twitter: VideoPlatform = {
  name: "twitter",
  domains: ["twitter.com", "x.com"],
  match(url) {
    const match = url.pathname.match(/\/status\/(\d+)/);
    if (!match?.[1]) return null;
    return createVideoInfo({
      platform: "twitter",
      videoId: match[1],
      canonicalUrl: `https://${normalizeHost(url.hostname)}/${url.pathname.replace(/\/+$/, "")}`,
      kind: "video",
      confidence: 0.9,
    });
  },
};

const tiktok: VideoPlatform = {
  name: "tiktok",
  domains: ["tiktok.com"],
  match(url) {
    const match = url.pathname.match(/\/video\/(\d+)/);
    if (!match?.[1]) return null;
    return createVideoInfo({
      platform: "tiktok",
      videoId: match[1],
      canonicalUrl: `https://www.tiktok.com${url.pathname.replace(/\/+$/, "")}`,
      kind: "video",
      confidence: 0.94,
    });
  },
};

const instagram: VideoPlatform = {
  name: "instagram",
  domains: ["instagram.com"],
  match(url) {
    const match = url.pathname.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
    if (!match?.[1]) return null;
    return createVideoInfo({
      platform: "instagram",
      videoId: match[1],
      canonicalUrl: `https://www.instagram.com${url.pathname.replace(/\/+$/, "")}/`,
      kind: "video",
      confidence: 0.92,
    });
  },
};

const holodex: VideoPlatform = {
  name: "holodex",
  domains: ["holodex.net"],
  match(url) {
    const segments = getPathSegments(url);

    if (segments[0] === "watch" && segments[1]) {
      return createVideoInfo({
        platform: "holodex",
        videoId: segments[1],
        canonicalUrl: `https://holodex.net/watch/${segments[1]}`,
        kind: "video",
        confidence: 0.96,
      });
    }

    if (segments[0] === "channel" && segments[1]) {
      return createVideoInfo({
        platform: "holodex",
        videoId: segments[1],
        canonicalUrl: `https://holodex.net/channel/${segments[1]}`,
        kind: "channel",
        confidence: 0.88,
      });
    }

    if (segments[0] === "multiview" && segments[1]) {
      return createVideoInfo({
        platform: "holodex",
        videoId: segments[1],
        canonicalUrl: `https://holodex.net/multiview/${segments[1]}`,
        kind: "playlist",
        confidence: 0.84,
      });
    }

    return null;
  },
};

const bilibili: VideoPlatform = {
  name: "bilibili",
  domains: ["bilibili.com", "b23.tv"],
  match(url) {
    const host = normalizeHost(url.hostname);
    const segments = getPathSegments(url);

    if (host === "b23.tv" && segments[0]) {
      return createVideoInfo({
        platform: "bilibili",
        videoId: segments[0],
        canonicalUrl: `https://b23.tv/${segments[0]}`,
        kind: "video",
        confidence: 0.88,
      });
    }

    if (host === "bilibili.com" && segments[0] === "video" && segments[1]) {
      return createVideoInfo({
        platform: "bilibili",
        videoId: segments[1],
        canonicalUrl: `https://www.bilibili.com/video/${segments[1]}`,
        kind: "video",
        confidence: 0.92,
      });
    }

    return null;
  },
};

const niconico: VideoPlatform = {
  name: "niconico",
  domains: ["nicovideo.jp"],
  match(url) {
    const segments = getPathSegments(url);
    if (segments[0] !== "watch" || !segments[1]) return null;
    return createVideoInfo({
      platform: "niconico",
      videoId: segments[1],
      canonicalUrl: `https://www.nicovideo.jp/watch/${segments[1]}`,
      kind: "video",
      confidence: 0.91,
    });
  },
};

const VTURB_SCRIPT_HOSTS = new Set(["scripts.converteai.net", "player.converteai.net"]);

const VTURB_CDN_HOSTS = new Set([
  "cdn.converteai.net",
  "na-cdn.converteai.net",
  "cdn-bb.converteai.net",
  "cdn-k.converteai.net",
  "cdn-cf-bb.converteai.net",
  "cdn.vturb.com.br",
]);

const vturb: VideoPlatform = {
  name: "vturb",
  domains: [
    "scripts.converteai.net",
    "cdn.converteai.net",
    "na-cdn.converteai.net",
    "cdn-bb.converteai.net",
    "cdn-k.converteai.net",
    "cdn-cf-bb.converteai.net",
    "player.converteai.net",
    "images.converteai.net",
    "vturb.com",
    "vturb.com.br",
    "api.vturb.com.br",
    "cdn.vturb.com.br",
  ],
  match(url) {
    const host = normalizeHost(url.hostname);
    const segments = getPathSegments(url);

    // scripts.converteai.net/{accountId}/players/{playerId}/...
    // Handles both legacy and v4 paths (v4 has extra /v4/ segment)
    if (VTURB_SCRIPT_HOSTS.has(host)) {
      if (segments[1] === "players" && segments[2]) {
        const accountId = segments[0];
        const playerId = segments[2];
        return createVideoInfo({
          platform: "vturb",
          videoId: playerId,
          canonicalUrl: `https://scripts.converteai.net/${accountId}/players/${playerId}/embed.html`,
          kind: "video",
          confidence: segments.includes("player.js") ? 0.9 : 0.95,
        });
      }

      if (segments[1] === "ab-test" && segments[2]) {
        return createVideoInfo({
          platform: "vturb",
          videoId: segments[2],
          canonicalUrl: url.toString(),
          kind: "video",
          confidence: 0.78,
        });
      }
    }

    // CDN hosts - direct video URLs (HLS/MP4)
    if (VTURB_CDN_HOSTS.has(host)) {
      const pathStr = url.pathname;
      if (/\.(m3u8|mp4|webm|mpd)(\?|$)/i.test(pathStr)) {
        const videoId = segments[0] ?? "unknown";
        return createVideoInfo({
          platform: "vturb",
          videoId,
          canonicalUrl: url.toString(),
          kind: "video",
          confidence: 0.96,
        });
      }
    }

    return null;
  },
};

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
  vturb,
];

const VIDEO_PLATFORM_DOMAINS = new Set(platforms.flatMap((platform) => platform.domains));

export function isVideoPlatformUrl(url: string): boolean {
  return extractVideoInfo(url) !== null;
}

export function isVideoPlatformDomain(url: string): boolean {
  const parsed = normalizeUrl(url);
  if (!parsed) return false;

  const host = normalizeHost(parsed.hostname);
  return VIDEO_PLATFORM_DOMAINS.has(host);
}

export function identifyPlatform(url: string): VideoPlatform | null {
  const parsed = normalizeUrl(url);
  if (!parsed) return null;

  for (const platform of platforms) {
    if (platform.match(parsed)) {
      return platform;
    }
  }

  return null;
}

export function extractVideoInfo(url: string): VideoInfo | null {
  const parsed = normalizeUrl(url);
  if (!parsed) return null;

  for (const platform of platforms) {
    const info = platform.match(parsed);
    if (info) {
      return info;
    }
  }

  return null;
}
