import { z } from "zod";

// ─── Crawl Config Schema ───

export const crawlConfigSchema = z.object({
  maxDepth: z.number().int().min(1).max(3).default(2),
  maxPages: z.number().int().min(1).max(50).default(20),
  maxConcurrent: z.number().int().min(1).max(10).default(5),
  followSameDomain: z.boolean().default(true),
  followSubdomains: z.boolean().default(true),
  followVideoPlatforms: z.boolean().default(true),
  followExternal: z.boolean().default(false),
  requestTimeout: z.number().int().min(5000).max(30000).default(10000),
  skipNavigationLinks: z.boolean().default(true),
});

// ─── Deep Crawl Request Schema ───

export const deepCrawlRequestSchema = z.object({
  url: z.url(),
  config: crawlConfigSchema.partial().optional(),
});

export type DeepCrawlRequest = z.infer<typeof deepCrawlRequestSchema>;

// ─── Media Item Schema ───

export const mediaItemSchema = z.object({
  url: z.string().min(1),
  type: z.enum(["image", "video"]),
  platform: z.string().nullable(),
  videoId: z.string().nullable(),
  title: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  duration: z.string().nullable(),
  source: z.string().min(1),
});

// ─── Page Result Schema ───

export const pageResultSchema = z.object({
  url: z.string().min(1),
  depth: z.number().int().nonnegative(),
  title: z.string().nullable(),
  media: z.array(mediaItemSchema),
  error: z.string().nullable(),
  possibleSpa: z.boolean(),
});

// ─── Crawl Result Schema ───

export const crawlResultSchema = z.object({
  originalUrl: z.string().min(1),
  pagesCrawled: z.number().int().nonnegative(),
  pagesWithErrors: z.number().int().nonnegative(),
  totalMedia: z.number().int().nonnegative(),
  results: z.array(pageResultSchema),
  crawlDurationMs: z.number().nonnegative(),
});

// ─── SSE Event Schemas ───

export const crawlStartedEventSchema = z.object({
  url: z.string().min(1),
  config: crawlConfigSchema,
});

export const pageDiscoveredEventSchema = z.object({
  url: z.string().min(1),
  category: z.enum(["video_platform", "same_domain", "subdomain", "external"]),
  depth: z.number().int().nonnegative(),
});

export const pageProcessingEventSchema = z.object({
  url: z.string().min(1),
  depth: z.number().int().nonnegative(),
  pagesDone: z.number().int().nonnegative(),
  pagesTotal: z.number().int().nonnegative(),
});

export const mediaFoundEventSchema = z.object({
  pageUrl: z.string().min(1),
  media: mediaItemSchema,
});

export const pageCompleteEventSchema = z.object({
  url: z.string().min(1),
  mediaCount: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
});

export const pageErrorEventSchema = z.object({
  url: z.string().min(1),
  error: z.string().min(1),
  depth: z.number().int().nonnegative(),
});

export const crawlCompleteEventSchema = z.object({
  originalUrl: z.string().min(1),
  totalPages: z.number().int().nonnegative(),
  pagesWithErrors: z.number().int().nonnegative(),
  totalMedia: z.number().int().nonnegative(),
  results: z.array(pageResultSchema),
  crawlDurationMs: z.number().nonnegative(),
});

export const crawlErrorEventSchema = z.object({
  error: z.string().min(1),
});

export const sseEventSchemas = {
  crawl_started: crawlStartedEventSchema,
  page_discovered: pageDiscoveredEventSchema,
  page_processing: pageProcessingEventSchema,
  media_found: mediaFoundEventSchema,
  page_complete: pageCompleteEventSchema,
  page_error: pageErrorEventSchema,
  crawl_complete: crawlCompleteEventSchema,
  crawl_error: crawlErrorEventSchema,
} as const;
