import { type NextRequest, NextResponse } from "next/server";
import { analyzePage } from "@/features/media-downloader/application/analyze-page";
import { analyzePageInputSchema, analyzePageResultSchema } from "@/features/media-downloader/domain/types";
import { handleApiError } from "@/server/api-utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, deepCrawl } = analyzePageInputSchema.parse(body);
    const raw = await analyzePage(url, deepCrawl);
    const result = analyzePageResultSchema.parse(raw);
    return NextResponse.json(result);
  } catch (err) {
    return await handleApiError(err);
  }
}
