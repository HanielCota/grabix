import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { act, createElement, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { type MeData, notifyUsageChanged, useMe } from "../../src/hooks/use-me.ts";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Helpers ───

function installFakeWindow(): EventTarget {
  const win = new EventTarget();
  (globalThis as Record<string, unknown>).window = win;
  return win;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  return {
    ok,
    status: init.status ?? (ok ? 200 : 400),
    json: async () => body,
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

const originalFetch = globalThis.fetch;

beforeEach(() => {
  installFakeWindow();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

// ─── Estado inicial e fetch ───

describe("useMe - estado inicial e fetch", () => {
  test("inicia com me nulo e loading true antes da resposta", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ authenticated: false })) as unknown as typeof fetch;

    const handle = renderHook(useMe);

    assert.equal(handle.result.current.me, null);
    assert.equal(handle.result.current.loading, true);

    await flush();
    handle.unmount();
  });

  test("popula me após fetch bem-sucedido e encerra o loading", async () => {
    const payload: MeData = {
      authenticated: true,
      plan: "pro",
      usage: { used: 3, limit: null, remaining: null },
    };
    globalThis.fetch = mock.fn(async () => jsonResponse(payload)) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    await flush();

    assert.deepEqual(handle.result.current.me, payload);
    assert.equal(handle.result.current.loading, false);

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].arguments[0], "/api/me");

    handle.unmount();
  });

  test("erro de rede mantém me nulo e encerra o loading", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    await flush();

    assert.equal(handle.result.current.me, null);
    assert.equal(handle.result.current.loading, false);

    handle.unmount();
  });

  test("falha ao parsear o JSON mantém me nulo", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    await flush();

    assert.equal(handle.result.current.me, null);
    assert.equal(handle.result.current.loading, false);

    handle.unmount();
  });

  test("ignora res.ok: resposta 500 com JSON válido popula me (comportamento atual)", async () => {
    // O hook nunca checa res.ok — um 500 com corpo JSON vira estado. Documentado como é.
    globalThis.fetch = mock.fn(async () =>
      jsonResponse({ authenticated: false }, { ok: false, status: 500 }),
    ) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    await flush();

    assert.deepEqual(handle.result.current.me, { authenticated: false });
    assert.equal(handle.result.current.loading, false);

    handle.unmount();
  });
});

// ─── Refetch: eventos e refresh manual ───

describe("useMe - refetch", () => {
  test("refaz o fetch ao receber o evento grabix:usage-changed", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse({ authenticated: true })) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    await flush();
    assert.equal((globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls.length, 1);

    act(() => {
      win.dispatchEvent(new Event("grabix:usage-changed"));
    });
    await flush();

    assert.equal((globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls.length, 2);

    handle.unmount();
  });

  test("refaz o fetch no evento focus da janela", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse({ authenticated: true })) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    await flush();

    act(() => {
      win.dispatchEvent(new Event("focus"));
    });
    await flush();

    assert.equal((globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls.length, 2);

    handle.unmount();
  });

  test("refresh() dispara um novo fetch manualmente", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ authenticated: true })) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    await flush();

    act(() => {
      handle.result.current.refresh();
    });
    await flush();

    assert.equal((globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls.length, 2);
    assert.deepEqual(handle.result.current.me, { authenticated: true });

    handle.unmount();
  });
});

// ─── Cleanup ───

describe("useMe - cleanup", () => {
  test("resolução tardia do fetch após unmount não atualiza estado nem lança erro", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    globalThis.fetch = mock.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    handle.unmount();

    resolveFetch?.(jsonResponse({ authenticated: true }));
    await flush();

    // Sem assertion de estado possível (componente desmontado): o teste passa
    // se nenhum erro/aviso de setState pós-unmount quebrar a execução.
    assert.equal((globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls.length, 1);
  });

  test("unmount remove os listeners de focus e usage-changed", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse({ authenticated: true })) as unknown as typeof fetch;

    const handle = renderHook(useMe);
    await flush();
    handle.unmount();

    act(() => {
      win.dispatchEvent(new Event("focus"));
      win.dispatchEvent(new Event("grabix:usage-changed"));
    });
    await flush();

    assert.equal((globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls.length, 1);
  });
});

// ─── notifyUsageChanged (função pura) ───

describe("notifyUsageChanged", () => {
  test("não lança quando window não existe", () => {
    delete (globalThis as Record<string, unknown>).window;
    assert.doesNotThrow(() => notifyUsageChanged());
  });

  test("dispara o evento grabix:usage-changed no window", () => {
    const win = installFakeWindow();
    const listener = mock.fn();
    win.addEventListener("grabix:usage-changed", listener);

    notifyUsageChanged();

    assert.equal(listener.mock.calls.length, 1);
  });
});
