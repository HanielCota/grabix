import { appConfig } from "@/server/config";
import { validateDnsResolution, validateUrlFormat } from "@/server/security";
import { Errors } from "../domain/errors";

export async function fetchPageHtml(rawUrl: string): Promise<{
  html: string;
  resolvedUrl: string;
}> {
  if (!rawUrl?.trim()) {
    throw Errors.invalidUrl("URL não pode ser vazia.");
  }

  const url = await validateUrlFormat(rawUrl);
  await validateDnsResolution(url.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.limits.fetchTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Grabix/1.0 (media-downloader; +https://github.com/grabix)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw Errors.fetchFailed("Timeout ao buscar página.");
    }
    throw Errors.fetchFailed("Erro de rede.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw Errors.fetchFailed(`Status HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("text/html")) {
    throw Errors.notHtml();
  }

  const contentLengthRaw = response.headers.get("content-length");
  if (contentLengthRaw) {
    const size = parseInt(contentLengthRaw, 10);
    if (!Number.isNaN(size) && size > appConfig.limits.maxHtmlSizeBytes) {
      throw Errors.htmlTooLarge();
    }
  }

  const html = await response.text();
  if (!html) {
    throw Errors.fetchFailed("HTML vazio recebido.");
  }

  if (html.length > appConfig.limits.maxHtmlSizeBytes) {
    throw Errors.htmlTooLarge();
  }

  return { html, resolvedUrl: response.url };
}
