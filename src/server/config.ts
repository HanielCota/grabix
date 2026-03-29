import { z } from "zod";

// ─── Config schema ───

const limitsSchema = z.object({
  fetchTimeoutMs: z.number().int().positive(),
  maxHtmlSizeBytes: z.number().int().positive(),
  maxAssets: z.number().int().positive().max(500),
  maxFileSizeBytes: z.number().int().positive(),
  maxZipSizeBytes: z.number().int().positive(),
  maxConcurrentDownloads: z.number().int().positive().max(10),
});

const crawlSchema = z.object({
  maxPages: z.number().int().positive().max(50),
  maxDepth: z.number().int().nonnegative().max(3),
  concurrency: z.number().int().positive().max(10),
  sameDomainOnly: z.boolean(),
});

const appConfigSchema = z.object({
  userAgent: z.string().min(1),
  limits: limitsSchema,
  crawl: crawlSchema,
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const appConfig: AppConfig = appConfigSchema.parse({
  userAgent: "Mozilla/5.0 (compatible; Grabix/1.0; +https://github.com/HanielCota/grabix)",
  limits: {
    fetchTimeoutMs: 15_000,
    maxHtmlSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxAssets: 200,
    maxFileSizeBytes: 100 * 1024 * 1024, // 100 MB
    maxZipSizeBytes: 500 * 1024 * 1024, // 500 MB
    maxConcurrentDownloads: 5,
  },
  crawl: {
    maxPages: 30,
    maxDepth: 2,
    concurrency: 5,
    sameDomainOnly: true,
  },
});
