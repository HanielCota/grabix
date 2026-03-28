import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import { appConfig } from "@/server/config";
import { validateDnsResolution, validateUrlFormat } from "@/server/security";
import { Errors } from "../domain/errors";
import { isMediaExtension } from "../domain/media-extensions";
import type { MediaAsset } from "../domain/types";

async function fetchAssetStream(asset: MediaAsset): Promise<{ stream: Readable; name: string } | null> {
  if (!asset?.url || !asset?.extension || !asset?.fileName) return null;

  try {
    const url = await validateUrlFormat(asset.url);

    if (!isMediaExtension(asset.extension)) return null;

    await validateDnsResolution(url.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), appConfig.limits.fetchTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": "Grabix/1.0 (media-downloader)" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok || !response.body) return null;

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > appConfig.limits.maxFileSizeBytes) {
      return null;
    }

    const stream = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
    return { stream, name: asset.fileName };
  } catch (_err) {
    return null;
  }
}

// ─── ZIP stream ───

export async function createZipStream(assets: MediaAsset[]): Promise<Readable> {
  if (!assets?.length) {
    throw Errors.tooManyAssets();
  }

  if (assets.length > appConfig.limits.maxAssets) {
    throw Errors.tooManyAssets();
  }

  const archive = archiver("zip", { zlib: { level: 1 } });
  const passThrough = new PassThrough();

  // Forward archive errors to passThrough so the consumer gets notified
  archive.on("error", (err) => {
    passThrough.destroy(err);
  });

  archive.pipe(passThrough);

  const concurrency = appConfig.limits.maxConcurrentDownloads;

  const processAssets = async () => {
    const usedNames = new Set<string>();

    for (let i = 0; i < assets.length; i += concurrency) {
      const batch = assets.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((asset) => fetchAssetStream(asset)));

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

        archive.append(result.stream, { name });
      }
    }

    await archive.finalize();
  };

  processAssets().catch((err) => {
    archive.abort();
    passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return passThrough;
}
