import { z } from "zod";
import { ALL_MEDIA_EXTENSION_LIST } from "./media-extensions";

// ─── Shared primitives ───

const safeFileName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^/\\]+$/, "Nome de arquivo invalido.");

const mediaExtension = z.enum(ALL_MEDIA_EXTENSION_LIST);

// ─── Domain schemas ───

export const mediaTypeSchema = z.enum(["IMAGE", "VIDEO"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const mediaAssetSchema = z.object({
  url: z.url(),
  type: mediaTypeSchema,
  fileName: safeFileName,
  extension: mediaExtension,
  sourceTag: z.string().min(1),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const analyzePageResultSchema = z.object({
  url: z.url(),
  totalFound: z.number().int().nonnegative(),
  assets: z.array(mediaAssetSchema),
  pagesScanned: z.number().int().positive().optional(),
});
export type AnalyzePageResult = z.infer<typeof analyzePageResultSchema>;

// ─── API input schemas ───

export const analyzePageInputSchema = z.object({
  url: z.url(),
  deepCrawl: z.boolean().optional().default(false),
});
export type AnalyzePageInput = z.infer<typeof analyzePageInputSchema>;

export const downloadAssetInputSchema = z.object({
  url: z.url(),
  fileName: safeFileName,
});

export const downloadZipInputSchema = z.object({
  assets: z.array(mediaAssetSchema).min(1).max(200),
});
