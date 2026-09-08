import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { act, createElement, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import type { MediaAsset } from "../../src/features/media-downloader/domain/types.ts";
import { useDownloadZip } from "../../src/hooks/use-download-zip.ts";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Helpers ───

function installFakeWindow(): EventTarget {
  const win = new EventTarget();
  (globalThis as Record<string, unknown>).window = win;
  return win;
}

interface FakeAnchor {
  href: string;
  download: string;
  click: ReturnType<typeof mock.fn>;
  remove: ReturnType<typeof mock.fn>;
}

let lastAnchor: FakeAnchor;
let appendedToBody: unknown[];

function installDomStubs(): void {
  lastAnchor = { href: "", download: "", click: mock.fn(), remove: mock.fn() };
  appendedToBody = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: () => lastAnchor,
    body: { appendChild: (el: unknown) => appendedToBody.push(el) },
  };
  (URL as unknown as Record<string, unknown>).createObjectURL = mock.fn(() => "blob:fake-zip");
  (URL as unknown as Record<string, unknown>).revokeObjectURL = mock.fn(() => {});
}

function removeDomStubs(): void {
  delete (globalThis as Record<string, unknown>).document;
  // Os stubs de URL ficam instalados: o hook agenda revokeObjectURL via
  // setTimeout(1000), que pode disparar depois do afterEach do teste.
}

function makeAsset(n: number): MediaAsset {
  return {
    url: `https://cdn.example.com/file-${n}.jpg`,
    type: "IMAGE",
    fileName: `file-${n}.jpg`,
    extension: "jpg",
    sourceTag: "img",
  };
}

function okZipResponse() {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["zip-binario"]),
  };
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
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

function fetchCalls() {
  return (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  installFakeWindow();
  installDomStubs();
});

afterEach(() => {
  removeDomStubs();
  delete (globalThis as Record<string, unknown>).window;
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

// ─── Estado inicial e fluxo de sucesso ───

describe("useDownloadZip - estado inicial e sucesso", () => {
  test("inicia com isZipping false e sem mensagem", () => {
    globalThis.fetch = mock.fn(async () => okZipResponse()) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));

    assert.equal(handle.result.current.isZipping, false);
    assert.equal(handle.result.current.zipMessage, null);

    handle.unmount();
  });

  test("baixa o ZIP: POST correto, âncora clicada, mensagem de sucesso e usage-changed", async () => {
    const win = installFakeWindow();
    const usageListener = mock.fn();
    win.addEventListener("grabix:usage-changed", usageListener);
    globalThis.fetch = mock.fn(async () => okZipResponse()) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));
    const assets = [makeAsset(1), makeAsset(2)];

    act(() => {
      handle.result.current.downloadZip(assets);
    });
    assert.equal(handle.result.current.isZipping, true, "isZipping liga durante o download");

    await flush();

    assert.equal(handle.result.current.isZipping, false);
    assert.deepEqual(handle.result.current.zipMessage, { type: "ok", text: "2 arquivos no ZIP." });

    const calls = fetchCalls();
    assert.equal(calls.length, 1);
    const [url, init] = calls[0].arguments as [string, RequestInit];
    assert.equal(url, "/api/download-zip");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body as string), { assets });

    assert.equal(lastAnchor.download, "grabix-example.com.zip");
    assert.equal(lastAnchor.href, "blob:fake-zip");
    assert.equal(lastAnchor.click.mock.calls.length, 1);
    assert.equal(lastAnchor.remove.mock.calls.length, 1);
    assert.equal(appendedToBody.length, 1);
    assert.equal(usageListener.mock.calls.length, 1, "notifyUsageChanged dispara após o sucesso");

    handle.unmount();
  });

  test("mensagem de sucesso usa singular para 1 arquivo", async () => {
    globalThis.fetch = mock.fn(async () => okZipResponse()) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));

    act(() => {
      handle.result.current.downloadZip([makeAsset(1)]);
    });
    await flush();

    assert.deepEqual(handle.result.current.zipMessage, { type: "ok", text: "1 arquivo no ZIP." });

    handle.unmount();
  });

  test("lista vazia não chama fetch", async () => {
    globalThis.fetch = mock.fn(async () => okZipResponse()) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));

    act(() => {
      handle.result.current.downloadZip([]);
    });
    await flush();

    assert.equal(fetchCalls().length, 0);
    assert.equal(handle.result.current.isZipping, false);
    assert.equal(handle.result.current.zipMessage, null);

    handle.unmount();
  });

  test("mais de 200 assets são truncados no limite do ZIP", async () => {
    globalThis.fetch = mock.fn(async () => okZipResponse()) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));
    const assets = Array.from({ length: 250 }, (_, i) => makeAsset(i));

    act(() => {
      handle.result.current.downloadZip(assets);
    });
    await flush();

    const body = JSON.parse((fetchCalls()[0].arguments as [string, RequestInit])[1].body as string);
    assert.equal(body.assets.length, 200);
    assert.deepEqual(handle.result.current.zipMessage, { type: "ok", text: "200 arquivos no ZIP." });

    handle.unmount();
  });

  test("mensagem de sucesso some automaticamente após 4 segundos", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = mock.fn(async () => okZipResponse()) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));

    act(() => {
      handle.result.current.downloadZip([makeAsset(1)]);
    });
    await flush();
    assert.equal(handle.result.current.zipMessage?.type, "ok");

    act(() => {
      mock.timers.tick(4000);
    });
    await flush();

    assert.equal(handle.result.current.zipMessage, null);
    const revoke = (URL as unknown as Record<string, unknown>).revokeObjectURL as ReturnType<typeof mock.fn>;
    assert.equal(revoke.mock.calls.length, 1, "revokeObjectURL é agendado após o download");

    handle.unmount();
    mock.timers.reset();
  });
});

// ─── Erros ───

describe("useDownloadZip - erros", () => {
  test("resposta não-ok mostra a mensagem de erro da API", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "ZIP grande demais." } }),
    })) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));

    act(() => {
      handle.result.current.downloadZip([makeAsset(1)]);
    });
    await flush();

    assert.equal(handle.result.current.isZipping, false);
    assert.deepEqual(handle.result.current.zipMessage, { type: "err", text: "ZIP grande demais." });
    assert.equal(lastAnchor.click.mock.calls.length, 0);

    handle.unmount();
  });

  test("resposta 402 chama onUpgradeRequired e limpa a mensagem", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({ error: { message: "Requer Pro" } }),
    })) as unknown as typeof fetch;
    const onUpgradeRequired = mock.fn();

    const handle = renderHook(() => useDownloadZip({ host: "example.com", onUpgradeRequired }));

    act(() => {
      handle.result.current.downloadZip([makeAsset(1)]);
    });
    await flush();

    assert.equal(onUpgradeRequired.mock.calls.length, 1);
    assert.equal(onUpgradeRequired.mock.calls[0].arguments[0], "o download em ZIP");
    assert.equal(handle.result.current.zipMessage, null);
    // Comportamento atual: isZipping não é desligado no caminho 402 (o modal de
    // upgrade assume a UI). Documentado aqui como é.
    assert.equal(handle.result.current.isZipping, true);

    handle.unmount();
  });

  test("erro de rede mostra mensagem de conexão", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));

    act(() => {
      handle.result.current.downloadZip([makeAsset(1)]);
    });
    await flush();

    assert.equal(handle.result.current.isZipping, false);
    assert.deepEqual(handle.result.current.zipMessage, { type: "err", text: "Erro de conexão ao gerar ZIP." });

    handle.unmount();
  });
});

// ─── Cancelamento e cleanup ───

describe("useDownloadZip - cancelamento e cleanup", () => {
  test("cancelZip desliga isZipping e a resposta tardia não gera mensagem", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    globalThis.fetch = mock.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));

    act(() => {
      handle.result.current.downloadZip([makeAsset(1)]);
    });
    assert.equal(handle.result.current.isZipping, true);

    act(() => {
      handle.result.current.cancelZip();
    });
    assert.equal(handle.result.current.isZipping, false);

    resolveFetch?.(okZipResponse());
    await flush();

    assert.equal(handle.result.current.zipMessage, null);
    assert.equal(lastAnchor.click.mock.calls.length, 0);

    handle.unmount();
  });

  test("unmount durante o download aborta sem quebrar", async () => {
    globalThis.fetch = mock.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;

    const handle = renderHook(() => useDownloadZip({ host: "example.com" }));

    act(() => {
      handle.result.current.downloadZip([makeAsset(1)]);
    });
    assert.equal(handle.result.current.isZipping, true);

    handle.unmount();
    await flush();

    // Sem setState pós-unmount: o teste passa se nada lançar.
    assert.equal(lastAnchor.click.mock.calls.length, 0);
  });
});
