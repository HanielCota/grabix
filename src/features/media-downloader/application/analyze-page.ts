import { Errors } from "../domain/errors";
import type { AnalyzePageResult } from "../domain/types";
import { fetchPageHtml } from "../infrastructure/html-fetcher";
import { extractMediaFromHtml } from "../infrastructure/media-extractor";

export async function analyzePage(rawUrl: string): Promise<AnalyzePageResult> {
  if (!rawUrl?.trim()) {
    throw Errors.invalidUrl("URL não pode ser vazia.");
  }

  const { html, resolvedUrl } = await fetchPageHtml(rawUrl);

  if (!html) {
    throw Errors.fetchFailed("HTML vazio recebido.");
  }

  const assets = await extractMediaFromHtml(html, resolvedUrl);

  return {
    url: resolvedUrl,
    totalFound: assets.length,
    assets,
  };
}
