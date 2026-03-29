import { PassThrough, Readable, Transform } from "node:stream";
import archiver from "archiver";
import { sanitizeFileName } from "@/lib/files/file-name";
import { appConfig } from "@/server/config";
import { safeFetch } from "@/server/safe-fetch";
import { AppError, Errors } from "../domain/errors";
import { isAllowedMediaContentType, isMediaExtension } from "../domain/media-extensions";
import type { MediaAsset } from "../domain/types";

async function fetchAssetStream(
  asset: MediaAsset,
  signal?: AbortSignal,
): Promise<{ stream: Readable; name: string } | null> {
  if (!asset?.url || !asset?.extension || !asset?.fileName) return null;

  try {
    if (!isMediaExtension(asset.extension)) return null;

    let response: Response;
    try {
      const result = await safeFetch(asset.url, {
        signal,
        timeoutMs: appConfig.limits.fetchTimeoutMs,
        headers: { "User-Agent": appConfig.userAgent },
      });
      response = result.response;
    } catch (err) {
      if (err instanceof AppError) return null;
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return null;
      return null;
    }

    if (!response.ok || !response.body) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!isAllowedMediaContentType(contentType)) return null;

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > appConfig.limits.maxFileSizeBytes) {
      return null;
    }

    const maxBytes = appConfig.limits.maxFileSizeBytes;
    let bytesRead = 0;
    const limitedBody = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          bytesRead += chunk.byteLength;
          if (bytesRead > maxBytes) {
            ctrl.error(Errors.fileTooLarge());
            return;
          }
          ctrl.enqueue(chunk);
        },
      }),
    );

    const stream = Readable.fromWeb(limitedBody as import("stream/web").ReadableStream);
    return { stream, name: sanitizeFileName(asset.fileName, `media.${asset.extension}`) };
  } catch (_err) {
    return null;
  }
}

// ─── ZIP stream ───

export async function createZipStream(assets: MediaAsset[], signal?: AbortSignal): Promise<Readable> {
  if (!assets?.length) {
    throw Errors.downloadFailed("Nenhum arquivo selecionado.");
  }

  if (assets.length > appConfig.limits.maxAssets) {
    throw Errors.tooManyAssets();
  }

  const archive = archiver("zip", { zlib: { level: 1 } });
  const passThrough = new PassThrough();
  const maxZipBytes = appConfig.limits.maxZipSizeBytes;
  let totalBytes = 0;

  // Forward archive errors to passThrough so the consumer gets notified
  archive.on("error", (err) => {
    passThrough.destroy(err);
  });

  archive.pipe(passThrough);

  const concurrency = appConfig.limits.maxConcurrentDownloads;
  const handleAbort = () => {
    archive.abort();
    passThrough.destroy(new Error("CLIENT_ABORTED"));
  };

  signal?.addEventListener("abort", handleAbort, { once: true });

  function withZipLimit(stream: Readable): Readable {
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        totalBytes += chunk.length;
        if (totalBytes > maxZipBytes) {
          callback(Errors.zipTooLarge());
          return;
        }
        callback(null, chunk);
      },
    });

    stream.on("error", (err) => {
      limiter.destroy(err);
    });

    return stream.pipe(limiter);
  }

  const processAssets = async () => {
    const usedNames = new Set<string>();
    let appendedCount = 0;

    for (let i = 0; i < assets.length; i += concurrency) {
      if (signal?.aborted) {
        throw new Error("CLIENT_ABORTED");
      }

      const batch = assets.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((asset) => fetchAssetStream(asset, signal)));

      for (const result of results) {
        if (!result) continue;

        let name = result.name;
        // Resolve name collisions
        if (usedNames.has(name)) {
          const dotIdx = name.lastIndexOf(".");
          const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
          const ext = dotIdx > 0 ? name.slice(dotIdx) : "";
          let suffix = 2;
          while (usedNames.has(`${base}-${suffix}${ext}`)) suffix++;
          name = `${base}-${suffix}${ext}`;
        }
        usedNames.add(name);

        archive.append(withZipLimit(result.stream), { name });
        appendedCount++;
      }
    }

    if (appendedCount === 0) {
      throw Errors.downloadFailed("Nenhum arquivo pôde ser baixado.");
    }

    await archive.finalize();
  };

  processAssets().catch((err) => {
    archive.abort();
    passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  passThrough.on("close", () => {
    signal?.removeEventListener("abort", handleAbort);
  });

  return passThrough;
}
