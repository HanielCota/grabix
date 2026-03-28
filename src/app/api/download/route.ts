import type { NextRequest } from "next/server";
import { downloadAsset } from "@/features/media-downloader/application/download-asset";
import { downloadAssetInputSchema } from "@/features/media-downloader/domain/types";
import { handleApiError } from "@/server/api-utils";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const input = downloadAssetInputSchema.parse({
      url: params.get("url") ?? "",
      fileName: params.get("fileName") ?? "download",
    });

    const result = await downloadAsset(input.url);
    const finalName = result.fileName ?? input.fileName;

    return new Response(result.stream, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(finalName)}"`,
        ...(result.contentLength != null && {
          "Content-Length": String(result.contentLength),
        }),
      },
    });
  } catch (err) {
    return await handleApiError(err);
  }
}
