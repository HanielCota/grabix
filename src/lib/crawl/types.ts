// ─── Link Discovery Types ───

export type LinkCategory = "video_platform" | "same_domain" | "subdomain" | "external";

export interface LinkCandidate {
  url: string;
  category: LinkCategory;
  anchorText: string;
  /** Text surrounding the link for relevance scoring */
  context: string;
  /** True if inside <nav>, <header>, or <footer> */
  isNavigation: boolean;
  /** 1 (highest) to 5 (lowest) */
  priority: number;
}

// ─── Platform Registry Types ───

export interface VideoPlatform {
  name: string;
  /** Regex patterns that identify URLs from this platform */
  patterns: RegExp[];
  /** Extract video ID from URL. Returns null if unable. */
  extractVideoId: (url: string) => string | null;
  /** Generate thumbnail URL from video ID, if possible */
  getThumbnailUrl?: (videoId: string) => string;
}

export interface VideoInfo {
  platform: string;
  videoId: string;
  thumbnailUrl: string | null;
}

// ─── Embed Discovery Types ───

export type EmbedSource =
  | "iframe"
  | "video_tag"
  | "embed_tag"
  | "object_tag"
  | "og_meta"
  | "twitter_meta"
  | "json_ld"
  | "data_attr"
  | "inline_script";

export interface EmbeddedMedia {
  url: string;
  type: "video" | "image";
  platform: string | null;
  videoId: string | null;
  thumbnailUrl: string | null;
  source: EmbedSource;
}

// ─── Crawl Config ───

export interface CrawlConfig {
  maxDepth: number;
  maxPages: number;
  maxConcurrent: number;
  followSameDomain: boolean;
  followSubdomains: boolean;
  followVideoPlatforms: boolean;
  followExternal: boolean;
  requestTimeout: number;
  skipNavigationLinks: boolean;
}

// ─── Crawl Results ───

export interface MediaItem {
  url: string;
  type: "image" | "video";
  platform: string | null;
  videoId: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  duration: string | null;
  source: string;
}

export interface PageResult {
  url: string;
  depth: number;
  title: string | null;
  media: MediaItem[];
  error: string | null;
  possibleSpa: boolean;
}

export interface CrawlResult {
  originalUrl: string;
  pagesCrawled: number;
  pagesWithErrors: number;
  totalMedia: number;
  results: PageResult[];
  crawlDurationMs: number;
}

// ─── SSE Event Types ───

export interface CrawlStartedEvent {
  url: string;
  config: CrawlConfig;
}

export interface PageDiscoveredEvent {
  url: string;
  category: LinkCategory;
  depth: number;
}

export interface PageProcessingEvent {
  url: string;
  depth: number;
  pagesDone: number;
  pagesTotal: number;
}

export interface MediaFoundEvent {
  pageUrl: string;
  media: MediaItem;
}

export interface PageCompleteEvent {
  url: string;
  mediaCount: number;
  depth: number;
}

export interface PageErrorEvent {
  url: string;
  error: string;
  depth: number;
}

export interface CrawlCompleteEvent {
  originalUrl: string;
  totalPages: number;
  pagesWithErrors: number;
  totalMedia: number;
  results: PageResult[];
  crawlDurationMs: number;
}

export interface CrawlErrorEvent {
  error: string;
}

export type SSEEventMap = {
  crawl_started: CrawlStartedEvent;
  page_discovered: PageDiscoveredEvent;
  page_processing: PageProcessingEvent;
  media_found: MediaFoundEvent;
  page_complete: PageCompleteEvent;
  page_error: PageErrorEvent;
  crawl_complete: CrawlCompleteEvent;
  crawl_error: CrawlErrorEvent;
};

export type SSEEventName = keyof SSEEventMap;

// ─── Activity Log (Frontend) ───

export type ActivityType = "discovered" | "processing" | "media_found" | "complete" | "error";

export interface ActivityLogEntry {
  id: string;
  type: ActivityType;
  url: string;
  message: string;
  timestamp: number;
}
