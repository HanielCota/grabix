import type { NextRequest } from "next/server";
import { downloadAsset } from "@/features/media-downloader/application/download-asset";
import { downloadAssetInputSchema } from "@/features/media-downloader/domain/types";
import { buildContentDisposition } from "@/lib/files/file-name";
import { handleApiError } from "@/server/api-utils";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const parsedInput = downloadAssetInputSchema.safeParse({
      url: params.get("url") ?? "",
      fileName: params.get("fileName") ?? "download",
    });
    if (!parsedInput.success) {
      return await handleApiError(parsedInput.error);
    }

    const input = parsedInput.data;
    const result = await downloadAsset(input.url, request.signal);
    const finalName = result.fileName ?? input.fileName;

    return new Response(result.stream, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": buildContentDisposition(finalName),
        ...(result.contentLength != null && {
          "Content-Length": String(result.contentLength),
        }),
      },
    });
  } catch (err) {
    return await handleApiError(err);
  }
}
