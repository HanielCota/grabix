import { appConfig } from "@/server/config";
import { safeFetch } from "@/server/safe-fetch";
import { classifyByExtension, getExtensionFromUrl, isMediaExtension } from "../domain/media-extensions";
import type { MediaAsset } from "../domain/types";

// ─── Tweet URL detection ───

const TWEET_HOSTS = new Set(["twitter.com", "x.com"]);

/**
 * Extracts the status id from a Twitter/X post URL, e.g.
 * https://x.com/user/status/123, https://mobile.twitter.com/user/status/123?s=20,
 * https://x.com/i/web/status/123. Returns null for anything else.
 */
export function getTweetId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    const isTweetHost = TWEET_HOSTS.has(host) || [...TWEET_HOSTS].some((h) => host.endsWith(`.${h}`));
    if (!isTweetHost) return null;
    const match = u.pathname.match(/\/status(?:es)?\/(\d+)(?:\/|$)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// ─── Syndication API ───
// Public endpoint behind Twitter's embed widgets: no auth, only a token
// derived from the tweet id (the same algorithm the widget itself uses).
// Tweets carry their real media (mp4 variants for videos AND "GIFs", which
// Twitter serves as looping mp4s) in `mediaDetails[].video_info.variants`.

const SYNDICATION_ENDPOINT = "https://cdn.syndication.twimg.com/tweet-result";

// Browser identity - the endpoint is meant for widgets running on other sites.
const SYNDICATION_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://platform.twitter.com/",
};

/** Pure, exported for tests. */
export function syndicationToken(tweetId: string): string {
  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

// ─── Response parsing ───

interface SyndicationVariant {
  bitrate?: number;
  content_type?: string;
  url?: string;
}

interface SyndicationMedia {
  type?: string;
  media_url_https?: string;
  video_info?: { variants?: SyndicationVariant[] };
}

interface SyndicationTweet {
  __typename?: string;
  mediaDetails?: (SyndicationMedia | null)[];
  photos?: ({ url?: string } | null)[];
}

/** Pure parser, exported for tests. */
export function parseTweetResult(data: unknown, tweetId: string): MediaAsset[] {
  if (!data || typeof data !== "object") return [];

  const tweet = data as SyndicationTweet;
  // TweetTombstone (deleted/unavailable), TweetUnavailable, etc. carry no media.
  if (tweet.__typename !== "Tweet") return [];

  const assets: MediaAsset[] = [];
  const seen = new Set<string>();
  const counters = { video: 0, gif: 0, photo: 0 };

  function push(rawUrl: unknown, kind: "video" | "gif" | "photo", fallbackExt: string): void {
    if (typeof rawUrl !== "string" || !rawUrl || seen.has(rawUrl)) return;

    const fromUrl = getExtensionFromUrl(rawUrl);
    const ext = fromUrl && isMediaExtension(fromUrl) ? fromUrl : fallbackExt;
    const type = classifyByExtension(ext);
    if (!type) return;

    seen.add(rawUrl);
    counters[kind]++;
    assets.push({
      url: rawUrl,
      type,
      fileName: `twitter-${tweetId}-${kind}-${counters[kind]}.${ext}`,
      extension: ext as MediaAsset["extension"],
      sourceTag: "twitter[syndication]",
    });
  }

  // The syndication payload is third-party data: validate shapes defensively
  // instead of trusting the types above.
  const mediaList = Array.isArray(tweet.mediaDetails) ? tweet.mediaDetails : [];

  for (const media of mediaList) {
    if (!media || typeof media !== "object") continue;

    if (media.type === "video" || media.type === "animated_gif") {
      const kind = media.type === "animated_gif" ? "gif" : "video";
      const variants = Array.isArray(media.video_info?.variants) ? media.video_info.variants : [];

      // Best-quality progressive mp4 wins; HLS only as a fallback (long videos).
      const bestMp4 = variants
        .filter((v) => v.content_type === "video/mp4" && v.url)
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (bestMp4?.url) {
        push(bestMp4.url, kind, "mp4");
        continue;
      }

      const hls = variants.find((v) => v.content_type?.toLowerCase().includes("mpegurl") && v.url);
      if (hls?.url) push(hls.url, kind, "m3u8");
      continue;
    }

    if (media.type === "photo") {
      push(media.media_url_https, "photo", "jpg");
    }
  }

  // Older responses expose photos only at the top level.
  const photoList = Array.isArray(tweet.photos) ? tweet.photos : [];
  for (const photo of photoList) {
    if (!photo || typeof photo !== "object") continue;
    push(photo.url, "photo", "jpg");
  }

  return assets;
}

// ─── Fetch ───

/**
 * Resolves the downloadable media of a public tweet (videos, GIFs-as-mp4 and
 * photos) through Twitter's syndication endpoint. Returns [] when the tweet is
 * unavailable, has no media, or the endpoint fails - callers decide whether
 * that's fatal.
 */
export async function extractTweetAssets(tweetId: string, signal?: AbortSignal): Promise<MediaAsset[]> {
  const url = `${SYNDICATION_ENDPOINT}?id=${tweetId}&token=${syndicationToken(tweetId)}&lang=en`;

  const { response } = await safeFetch(url, {
    timeoutMs: appConfig.limits.fetchTimeoutMs,
    signal,
    headers: SYNDICATION_HEADERS,
  });

  if (!response.ok) return [];

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return [];

  const data: unknown = await response.json().catch(() => null);
  return parseTweetResult(data, tweetId);
}
