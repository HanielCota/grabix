import { type NextRequest, NextResponse } from "next/server";
import { analyzePage } from "@/features/media-downloader/application/analyze-page";
import { analyzePageInputSchema } from "@/features/media-downloader/domain/types";
import { handleApiError } from "@/server/api-utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = analyzePageInputSchema.parse(body);
    const result = await analyzePage(url);
    return NextResponse.json(result);
  } catch (err) {
    return await handleApiError(err);
  }
}
