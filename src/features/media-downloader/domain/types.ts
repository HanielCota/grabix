import { z } from "zod";
import { ALL_MEDIA_EXTENSION_LIST } from "./media-extensions";

// ─── Domain types ───

export const MediaType = {
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
} as const;

export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export interface MediaAsset {
  url: string;
  type: MediaType;
  fileName: string;
  extension: string;
  sourceTag: string;
}

export interface AnalyzePageResult {
  url: string;
  totalFound: number;
  assets: MediaAsset[];
}

// ─── API schemas (Zod) ───

const safeFileName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^/\\]+$/, "Nome de arquivo invalido.");
const mediaExtension = z.enum(ALL_MEDIA_EXTENSION_LIST);

export const mediaAssetSchema = z.object({
  url: z.url(),
  type: z.enum(["IMAGE", "VIDEO"]),
  fileName: safeFileName,
  extension: mediaExtension,
  sourceTag: z.string().min(1),
});

export const analyzePageInputSchema = z.object({
  url: z.url(),
});

export const downloadAssetInputSchema = z.object({
  url: z.url(),
  fileName: safeFileName,
});

export const downloadZipInputSchema = z.object({
  assets: z.array(mediaAssetSchema).min(1).max(200),
});
