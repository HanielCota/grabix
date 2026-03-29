import type { NextRequest } from "next/server";
import { runDeepCrawl } from "@/lib/crawl/orchestrator";
import { deepCrawlRequestSchema } from "@/lib/crawl/schemas";
import type { SSEEventMap, SSEEventName } from "@/lib/crawl/types";
import { handleApiError } from "@/server/api-utils";
import { validateDnsResolution, validateUrlFormat } from "@/server/security";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return await handleApiError(err);
  }

  const parsed = deepCrawlRequestSchema.safeParse(body);
  if (!parsed.success) {
    return await handleApiError(parsed.error);
  }

  try {
    const normalizedUrl = await validateUrlFormat(parsed.data.url);
    await validateDnsResolution(normalizedUrl.hostname);

    const url = normalizedUrl.toString();
    const config = parsed.data.config ?? {};
    const encoder = new TextEncoder();
    const abortController = new AbortController();

    request.signal.addEventListener("abort", () => abortController.abort(), { once: true });

    const stream = new ReadableStream({
      async start(controller) {
        function send<E extends SSEEventName>(event: E, data: SSEEventMap[E]) {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Stream closed — ignore
          }
        }

        try {
          await runDeepCrawl(url, config, send, abortController.signal);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Erro desconhecido";
          send("crawl_error", { error: message });
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return await handleApiError(err);
  }
}
