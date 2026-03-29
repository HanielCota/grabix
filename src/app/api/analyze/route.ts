import { type NextRequest, NextResponse } from "next/server";
import { analyzePage } from "@/features/media-downloader/application/analyze-page";
import { analyzePageInputSchema, analyzePageResultSchema } from "@/features/media-downloader/domain/types";
import { handleApiError } from "@/server/api-utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsedInput = analyzePageInputSchema.safeParse(body);
    if (!parsedInput.success) {
      return await handleApiError(parsedInput.error);
    }

    const { url, deepCrawl } = parsedInput.data;
    const raw = await analyzePage(url, deepCrawl, request.signal);
    const parsedResult = analyzePageResultSchema.safeParse(raw);
    if (!parsedResult.success) {
      return await handleApiError(parsedResult.error);
    }

    const result = parsedResult.data;
    return NextResponse.json(result);
  } catch (err) {
    return await handleApiError(err);
  }
}
