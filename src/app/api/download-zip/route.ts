import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { createZipStream } from "@/features/media-downloader/application/download-zip";
import { downloadZipInputSchema } from "@/features/media-downloader/domain/types";
import { buildContentDisposition } from "@/lib/files/file-name";
import { handleApiError } from "@/server/api-utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsedInput = downloadZipInputSchema.safeParse(body);
    if (!parsedInput.success) {
      return await handleApiError(parsedInput.error);
    }

    const { assets } = parsedInput.data;
    const zipStream = await createZipStream(assets, request.signal);

    const webStream = Readable.toWeb(zipStream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": buildContentDisposition("grabix-media.zip"),
      },
    });
  } catch (err) {
    return await handleApiError(err);
  }
}
