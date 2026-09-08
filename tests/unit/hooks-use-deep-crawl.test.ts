import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { act, createElement, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { useDeepCrawl } from "../../src/hooks/use-deep-crawl.ts";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Helpers ───

function installFakeWindow(): EventTarget {
  const win = new EventTarget();
  (globalThis as Record<string, unknown>).window = win;
  return win;
}

interface HookHandle<T> {
  result: { current: T };
  unmount: () => void;
}

function renderHook<T>(useHook: () => T): HookHandle<T> {
  const result = {} as { current: T };
  function Probe(): ReactNode {
    result.current = useHook();
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(createElement(Probe));
  });
  return {
    result,
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(condition: () => boolean, tries = 20): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) await flush();
  assert.ok(condition(), "condição não atingida dentro do limite de tentativas");
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}`;
}

function sseResponse(events: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`${events.join("\n\n")}\n\n`));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream };
}

/** Stream que nunca fecha: simula um crawl em andamento. */
function hangingResponse() {
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  return { ok: true, status: 200, body: stream };
}

function mediaItem(url = "https://example.com/video.mp4") {
  return {
    url,
    type: "video",
    platform: null,
    videoId: null,
    title: null,
    thumbnailUrl: null,
    canonicalUrl: null,
    contentKind: null,
    confidence: null,
    duration: null,
    source: "html",
    downloadable: true,
    discoveredFrom: null,
    discoveryReason: null,
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  installFakeWindow();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

// ─── Estado inicial e início do crawl ───

describe("useDeepCrawl - estado inicial e startCrawl", () => {
  test("inicia idle, sem progresso, log, resultados ou erro", () => {
    globalThis.fetch = mock.fn(async () => hangingResponse()) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);

    assert.equal(handle.result.current.status, "idle");
    assert.deepEqual(handle.result.current.progress, { pagesDone: 0, pagesTotal: 0, mediaFound: 0 });
    assert.deepEqual(handle.result.current.activityLog, []);
    assert.equal(handle.result.current.results, null);
    assert.equal(handle.result.current.error, null);

    handle.unmount();
  });

  test("startCrawl faz POST em /api/extract/deep com url e config, e muda para crawling", async () => {
    globalThis.fetch = mock.fn(async () => hangingResponse()) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);

    act(() => {
      handle.result.current.startCrawl("https://example.com", { maxDepth: 2 });
    });

    assert.equal(handle.result.current.status, "crawling");

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    assert.equal(calls.length, 1);
    const [url, init] = calls[0].arguments as [string, RequestInit];
    assert.equal(url, "/api/extract/deep");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body as string), { url: "https://example.com", config: { maxDepth: 2 } });

    handle.unmount();
  });
});

// ─── Processamento do stream SSE ───

describe("useDeepCrawl - stream SSE", () => {
  test("eventos atualizam progresso, log e concluem com resultados", async () => {
    globalThis.fetch = mock.fn(async () =>
      sseResponse([
        sseEvent("page_processing", { url: "https://example.com/a", depth: 0, pagesDone: 1, pagesTotal: 2 }),
        sseEvent("media_found", { pageUrl: "https://example.com/a", media: mediaItem() }),
        sseEvent("crawl_complete", {
          originalUrl: "https://example.com",
          totalPages: 2,
          pagesWithErrors: 0,
          totalMedia: 1,
          results: [],
          crawlDurationMs: 123,
        }),
      ]),
    ) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });

    await waitFor(() => handle.result.current.status === "complete");

    const { progress, results, activityLog } = handle.result.current;
    assert.deepEqual(progress, { pagesDone: 1, pagesTotal: 2, mediaFound: 1 });
    assert.equal(results?.originalUrl, "https://example.com");
    assert.equal(results?.pagesCrawled, 2);
    assert.equal(results?.totalMedia, 1);
    assert.equal(results?.crawlDurationMs, 123);

    const types = activityLog.map((entry) => entry.type);
    assert.ok(types.includes("processing"));
    assert.ok(types.includes("media_found"));

    handle.unmount();
  });

  test("page_discovered, page_complete e page_error geram entradas de log formatadas", async () => {
    globalThis.fetch = mock.fn(async () =>
      sseResponse([
        sseEvent("page_discovered", {
          url: "https://example.com/b",
          category: "same_domain",
          depth: 1,
          source: "anchor",
          fromUrl: "https://example.com",
          discoveryReason: "content-hub",
        }),
        sseEvent("page_complete", { url: "https://example.com/a", mediaCount: 3, depth: 0 }),
        sseEvent("page_error", { url: "https://example.com/c", error: "timeout", depth: 1 }),
        sseEvent("crawl_complete", {
          originalUrl: "https://example.com",
          totalPages: 1,
          pagesWithErrors: 1,
          totalMedia: 0,
          results: [],
          crawlDurationMs: 50,
        }),
      ]),
    ) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });

    await waitFor(() => handle.result.current.status === "complete");

    const messages = handle.result.current.activityLog.map((entry) => entry.message);
    assert.ok(
      messages.some((m) => m.includes("Página descoberta via link (depth 1) • hub de conteúdo")),
      `mensagens: ${JSON.stringify(messages)}`,
    );
    assert.ok(messages.some((m) => m.includes("3 mídia(s) encontrada(s)")));
    assert.ok(messages.some((m) => m.includes("Erro: timeout")));

    handle.unmount();
  });

  test("evento com payload inválido é ignorado sem quebrar o stream", async () => {
    globalThis.fetch = mock.fn(async () =>
      sseResponse([
        sseEvent("page_processing", { url: "não-é-url", depth: -1 }),
        sseEvent("media_found", { pageUrl: "https://example.com/a", media: { url: "x" } }),
        sseEvent("crawl_complete", {
          originalUrl: "https://example.com",
          totalPages: 0,
          pagesWithErrors: 0,
          totalMedia: 0,
          results: [],
          crawlDurationMs: 10,
        }),
      ]),
    ) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });

    await waitFor(() => handle.result.current.status === "complete");

    assert.deepEqual(handle.result.current.progress, { pagesDone: 0, pagesTotal: 0, mediaFound: 0 });
    assert.deepEqual(handle.result.current.activityLog, []);

    handle.unmount();
  });

  test("crawl_error define status error com a mensagem do evento", async () => {
    globalThis.fetch = mock.fn(async () =>
      sseResponse([sseEvent("crawl_error", { error: "URL não permitida" })]),
    ) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });

    await waitFor(() => handle.result.current.status === "error");

    assert.equal(handle.result.current.error, "URL não permitida");

    handle.unmount();
  });
});

// ─── Erros de transporte ───

describe("useDeepCrawl - erros", () => {
  test("resposta não-ok define error com a mensagem da API", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "Deep crawl requer plano Pro" } }),
    })) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });

    await waitFor(() => handle.result.current.status === "error");

    assert.equal(handle.result.current.error, "Deep crawl requer plano Pro");

    handle.unmount();
  });

  test("resposta sem body define error de streaming não suportado", async () => {
    globalThis.fetch = mock.fn(async () => ({ ok: true, status: 200, body: null })) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });

    await waitFor(() => handle.result.current.status === "error");

    assert.equal(handle.result.current.error, "Streaming não suportado pelo navegador.");

    handle.unmount();
  });

  test("erro de rede define error de falha na conexão", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });

    await waitFor(() => handle.result.current.status === "error");

    assert.equal(handle.result.current.error, "Falha na conexão: boom");

    handle.unmount();
  });
});

// ─── abort e reset ───

describe("useDeepCrawl - abort e reset", () => {
  test("abort() cancela o crawl e define a mensagem de cancelamento", async () => {
    // fetch que só rejeita quando o signal é abortado (como o fetch real).
    globalThis.fetch = mock.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });
    assert.equal(handle.result.current.status, "crawling");

    act(() => {
      handle.result.current.abort();
    });
    await flush();

    assert.equal(handle.result.current.status, "error");
    assert.equal(handle.result.current.error, "Crawl cancelado pelo usuário.");

    handle.unmount();
  });

  test("reset() volta ao estado inicial após um erro", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com", {});
    });
    await waitFor(() => handle.result.current.status === "error");

    act(() => {
      handle.result.current.reset();
    });

    assert.equal(handle.result.current.status, "idle");
    assert.equal(handle.result.current.error, null);
    assert.deepEqual(handle.result.current.progress, { pagesDone: 0, pagesTotal: 0, mediaFound: 0 });

    handle.unmount();
  });

  test("eventos tardios de um crawl substituído são descartados", async () => {
    // Primeiro crawl: stream controlado manualmente. Segundo crawl: completa na hora.
    let firstController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();
    let call = 0;
    globalThis.fetch = mock.fn(async () => {
      call += 1;
      if (call === 1) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            firstController = controller;
          },
        });
        return { ok: true, status: 200, body: stream };
      }
      return sseResponse([
        sseEvent("crawl_complete", {
          originalUrl: "https://example.com/novo",
          totalPages: 1,
          pagesWithErrors: 0,
          totalMedia: 0,
          results: [],
          crawlDurationMs: 5,
        }),
      ]);
    }) as unknown as typeof fetch;

    const handle = renderHook(useDeepCrawl);
    act(() => {
      handle.result.current.startCrawl("https://example.com/antigo", {});
    });
    await flush();

    act(() => {
      handle.result.current.startCrawl("https://example.com/novo", {});
    });
    await waitFor(() => handle.result.current.status === "complete");
    assert.equal(handle.result.current.results?.originalUrl, "https://example.com/novo");

    // Evento tardio do stream antigo (já abortado) não pode sobrescrever o resultado.
    act(() => {
      firstController?.enqueue(
        encoder.encode(
          `${sseEvent("crawl_complete", {
            originalUrl: "https://example.com/antigo",
            totalPages: 99,
            pagesWithErrors: 0,
            totalMedia: 99,
            results: [],
            crawlDurationMs: 1,
          })}\n\n`,
        ),
      );
    });
    await flush();

    assert.equal(handle.result.current.results?.originalUrl, "https://example.com/novo");
    assert.equal(handle.result.current.results?.totalMedia, 0);

    handle.unmount();
  });
});
