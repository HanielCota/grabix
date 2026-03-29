import { z } from "zod";

// ─── Helpers ───

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

function envStr(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

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
  enableJsRendering: z.boolean(),
  limits: limitsSchema,
  crawl: crawlSchema,
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const appConfig: AppConfig = appConfigSchema.parse({
  userAgent: envStr("GRABIX_USER_AGENT", "Mozilla/5.0 (compatible; Grabix/1.0; +https://github.com/HanielCota/grabix)"),
  enableJsRendering: envBool("GRABIX_JS_RENDERING", false),
  limits: {
    fetchTimeoutMs: envInt("GRABIX_FETCH_TIMEOUT_MS", 15_000),
    maxHtmlSizeBytes: envInt("GRABIX_MAX_HTML_SIZE_BYTES", 10 * 1024 * 1024),
    maxAssets: envInt("GRABIX_MAX_ASSETS", 200),
    maxFileSizeBytes: envInt("GRABIX_MAX_FILE_SIZE_BYTES", 100 * 1024 * 1024),
    maxZipSizeBytes: envInt("GRABIX_MAX_ZIP_SIZE_BYTES", 500 * 1024 * 1024),
    maxConcurrentDownloads: envInt("GRABIX_MAX_CONCURRENT_DOWNLOADS", 5),
  },
  crawl: {
    maxPages: envInt("GRABIX_CRAWL_MAX_PAGES", 30),
    maxDepth: envInt("GRABIX_CRAWL_MAX_DEPTH", 2),
    concurrency: envInt("GRABIX_CRAWL_CONCURRENCY", 5),
    sameDomainOnly: envBool("GRABIX_CRAWL_SAME_DOMAIN_ONLY", true),
  },
});
