import { type NextRequest, NextResponse } from "next/server";
import { runDeepCrawl } from "@/lib/crawl/orchestrator";
import { deepCrawlRequestSchema } from "@/lib/crawl/schemas";
import type { SSEEventMap, SSEEventName } from "@/lib/crawl/types";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body inválido." } }, { status: 400 });
  }

  const parsed = deepCrawlRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const { url, config } = parsed.data;
  const encoder = new TextEncoder();
  const abortController = new AbortController();

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
        await runDeepCrawl(url, config ?? {}, send, abortController.signal);
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
}
