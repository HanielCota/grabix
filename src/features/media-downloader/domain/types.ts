import { z } from "zod";
import { MAX_FILE_NAME_LENGTH, sanitizeFileName } from "@/lib/files/file-name";
import { getPublicUrlError, normalizeHttpUrlInput } from "@/lib/url/public-url";
import { ALL_MEDIA_EXTENSION_LIST } from "./media-extensions";

// ─── Shared primitives ───

export const publicHttpUrlSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const error = getPublicUrlError(value);
    if (error) {
      ctx.addIssue({ code: "custom", message: error });
    }
  })
  .transform((value) => normalizeHttpUrlInput(value));

const safeFileName = z
  .string()
  .trim()
  .transform((value) => sanitizeFileName(value))
  .pipe(z.string().min(1).max(MAX_FILE_NAME_LENGTH));

const mediaExtension = z.enum(ALL_MEDIA_EXTENSION_LIST);

// ─── Domain schemas ───

export const mediaTypeSchema = z.enum(["IMAGE", "VIDEO"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const mediaAssetSchema = z.object({
  url: publicHttpUrlSchema,
  type: mediaTypeSchema,
  fileName: safeFileName,
  extension: mediaExtension,
  sourceTag: z.string().min(1),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const analyzePageResultSchema = z.object({
  url: publicHttpUrlSchema,
  totalFound: z.number().int().nonnegative(),
  assets: z.array(mediaAssetSchema),
  pagesScanned: z.number().int().positive().optional(),
});
export type AnalyzePageResult = z.infer<typeof analyzePageResultSchema>;

// ─── API input schemas ───

export const analyzePageInputSchema = z.object({
  url: publicHttpUrlSchema,
  deepCrawl: z.boolean().optional().default(false),
});
export type AnalyzePageInput = z.infer<typeof analyzePageInputSchema>;

export const downloadAssetInputSchema = z.object({
  url: publicHttpUrlSchema,
  fileName: safeFileName,
});

export const downloadZipInputSchema = z.object({
  assets: z.array(mediaAssetSchema).min(1).max(200),
});
