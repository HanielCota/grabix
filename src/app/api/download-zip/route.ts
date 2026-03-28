import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { createZipStream } from "@/features/media-downloader/application/download-zip";
import { downloadZipInputSchema } from "@/features/media-downloader/domain/types";
import { handleApiError } from "@/server/api-utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assets } = downloadZipInputSchema.parse(body);

    const zipStream = await createZipStream(assets);

    const webStream = Readable.toWeb(zipStream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="grabix-media.zip"`,
      },
    });
  } catch (err) {
    return await handleApiError(err);
  }
}
