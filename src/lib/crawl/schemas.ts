import { z } from "zod";
import { publicHttpUrlSchema } from "@/features/media-downloader/domain/types";

const linkCategorySchema = z.enum(["video_platform", "same_domain", "subdomain", "external"]);
const linkSourceSchema = z.enum(["anchor", "button", "data_attr", "data_settings", "onclick"]);
const mediaContentKindSchema = z.enum(["video", "live", "short", "clip", "playlist", "channel", "embed"]);
const pageKindSchema = z.enum(["landing", "hub", "listing", "media", "platform", "unknown"]);
const confidenceSchema = z.number().min(0).max(1);

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
  url: publicHttpUrlSchema,
  config: crawlConfigSchema.partial().optional(),
});

export type DeepCrawlRequest = z.infer<typeof deepCrawlRequestSchema>;

// ─── Media Item Schema ───

export const mediaItemSchema = z.object({
  url: publicHttpUrlSchema,
  type: z.enum(["image", "video"]),
  platform: z.string().nullable(),
  videoId: z.string().nullable(),
  title: z.string().nullable(),
  thumbnailUrl: publicHttpUrlSchema.nullable(),
  canonicalUrl: publicHttpUrlSchema.nullable(),
  contentKind: mediaContentKindSchema.nullable(),
  confidence: confidenceSchema.nullable(),
  duration: z.string().nullable(),
  source: z.string().min(1),
  downloadable: z.boolean(),
  discoveredFrom: publicHttpUrlSchema.nullable(),
  discoveryReason: z.string().nullable(),
});

// ─── Page Result Schema ───

export const pageResultSchema = z.object({
  url: publicHttpUrlSchema,
  depth: z.number().int().nonnegative(),
  title: z.string().nullable(),
  media: z.array(mediaItemSchema),
  error: z.string().nullable(),
  possibleSpa: z.boolean(),
  pageKind: pageKindSchema,
  discoveredFrom: publicHttpUrlSchema.nullable(),
  discoveryReason: z.string().nullable(),
});

// ─── Crawl Result Schema ───

export const crawlResultSchema = z.object({
  originalUrl: publicHttpUrlSchema,
  pagesCrawled: z.number().int().nonnegative(),
  pagesWithErrors: z.number().int().nonnegative(),
  totalMedia: z.number().int().nonnegative(),
  results: z.array(pageResultSchema),
  crawlDurationMs: z.number().nonnegative(),
});

// ─── SSE Event Schemas ───

export const crawlStartedEventSchema = z.object({
  url: publicHttpUrlSchema,
  config: crawlConfigSchema,
});

export const pageDiscoveredEventSchema = z.object({
  url: publicHttpUrlSchema,
  category: linkCategorySchema,
  depth: z.number().int().nonnegative(),
  source: linkSourceSchema,
  fromUrl: publicHttpUrlSchema,
  discoveryReason: z.string().nullable(),
});

export const pageProcessingEventSchema = z.object({
  url: publicHttpUrlSchema,
  depth: z.number().int().nonnegative(),
  pagesDone: z.number().int().nonnegative(),
  pagesTotal: z.number().int().nonnegative(),
});

export const mediaFoundEventSchema = z.object({
  pageUrl: publicHttpUrlSchema,
  media: mediaItemSchema,
});

export const pageCompleteEventSchema = z.object({
  url: publicHttpUrlSchema,
  mediaCount: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
});

export const pageErrorEventSchema = z.object({
  url: publicHttpUrlSchema,
  error: z.string().min(1),
  depth: z.number().int().nonnegative(),
});

export const crawlCompleteEventSchema = z.object({
  originalUrl: publicHttpUrlSchema,
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
