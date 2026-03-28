import { appConfig } from "@/server/config";
import { validateDnsResolution, validateUrlFormat } from "@/server/security";
import { Errors } from "../domain/errors";
import { getExtensionFromUrl, isMediaExtension } from "../domain/media-extensions";

export async function downloadAsset(rawUrl: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  fileName: string | null;
}> {
  if (!rawUrl?.trim()) {
    throw Errors.invalidUrl("URL não pode ser vazia.");
  }

  const url = await validateUrlFormat(rawUrl);

  const ext = getExtensionFromUrl(url.toString());
  if (!ext || !isMediaExtension(ext)) {
    throw Errors.invalidMediaType();
  }

  await validateDnsResolution(url.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.limits.fetchTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": appConfig.userAgent },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw Errors.downloadFailed("Timeout.");
    }
    throw Errors.downloadFailed("Erro de rede.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw Errors.downloadFailed(`Status HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isValidType = ["image/", "video/", "application/octet-stream"].some((t) => contentType.includes(t));

  if (!isValidType) {
    throw Errors.invalidMediaType();
  }

  const contentLengthRaw = response.headers.get("content-length");
  const contentLength = contentLengthRaw ? parseInt(contentLengthRaw, 10) : null;

  if (contentLength != null && contentLength > appConfig.limits.maxFileSizeBytes) {
    throw Errors.fileTooLarge();
  }

  const body = response.body;
  if (!body) {
    throw Errors.downloadFailed("Resposta sem corpo.");
  }

  // Extract filename from Content-Disposition
  let fileName: string | null = null;
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (match?.[1]) {
      fileName = match[1].replace(/['"]/g, "").trim() || null;
    }
  }

  // Wrap stream with size limit
  const maxBytes = appConfig.limits.maxFileSizeBytes;
  let bytesRead = 0;
  const limitedStream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        bytesRead += chunk.byteLength;
        if (bytesRead > maxBytes) {
          ctrl.error(new Error("FILE_TOO_LARGE"));
          return;
        }
        ctrl.enqueue(chunk);
      },
    }),
  );

  return {
    stream: limitedStream,
    contentType: contentType || "application/octet-stream",
    contentLength,
    fileName,
  };
}
