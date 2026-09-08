import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { act, createElement, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { invalidatePlansCache, usePlans } from "../../src/hooks/use-plans.ts";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Helpers ───

function installFakeWindow(): EventTarget {
  const win = new EventTarget();
  (globalThis as Record<string, unknown>).window = win;
  return win;
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

const FREE_SNAPSHOT = {
  maxAssets: 10,
  maxFileSizeBytes: 50 * 1024 * 1024,
  maxZipSizeBytes: 100 * 1024 * 1024,
  maxConcurrentDownloads: 2,
  deepCrawl: false,
  jsRendering: false,
  protectedVideo: false,
  downloadsPerDay: 20,
};

const PRO_SNAPSHOT = {
  ...FREE_SNAPSHOT,
  maxAssets: 200,
  deepCrawl: true,
  downloadsPerDay: -1, // ilimitado → Infinity
};

function plansPayload() {
  return {
    free: FREE_SNAPSHOT,
    pro: PRO_SNAPSHOT,
    pricing: { amountCents: 2490, label: "R$ 24,90/mês" },
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

function fetchCallCount(): number {
  return (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls.length;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  installFakeWindow();
  invalidatePlansCache();
});

afterEach(() => {
  invalidatePlansCache();
  delete (globalThis as Record<string, unknown>).window;
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

// ─── Estado inicial e fetch ───

describe("usePlans - estado inicial e fetch", () => {
  test("inicia sem dados e com loading true quando o cache está vazio", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse(plansPayload())) as unknown as typeof fetch;

    const handle = renderHook(usePlans);

    assert.equal(handle.result.current.plans, null);
    assert.equal(handle.result.current.loading, true);

    await flush();
    handle.unmount();
  });

  test("popula plans após fetch bem-sucedido, convertendo snapshots em Plan", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse(plansPayload())) as unknown as typeof fetch;

    const handle = renderHook(usePlans);
    await flush();

    const { plans, loading } = handle.result.current;
    assert.equal(loading, false);
    assert.equal(plans?.free.id, "free");
    assert.equal(plans?.free.limits.maxAssets, 10);
    assert.equal(plans?.pro.features.deepCrawl, true);
    assert.equal(plans?.pro.quota.downloadsPerDay, Number.POSITIVE_INFINITY, "downloadsPerDay -1 vira ilimitado");
    assert.deepEqual(plans?.pricing, { amountCents: 2490, label: "R$ 24,90/mês" });

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].arguments[0], "/api/plans");

    handle.unmount();
  });

  test("erro de rede usa o fallback local (PLANS/PRICING) e encerra o loading", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const handle = renderHook(usePlans);
    await flush();

    const { plans, loading } = handle.result.current;
    assert.equal(loading, false);
    assert.equal(plans?.free.id, "free");
    assert.equal(plans?.pro.id, "pro");
    assert.equal(plans?.pricing.amountCents, 1990);
    assert.equal(typeof plans?.pricing.label, "string");

    handle.unmount();
  });

  test("refresh() retorna os dados de planos", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse(plansPayload())) as unknown as typeof fetch;

    const handle = renderHook(usePlans);
    await flush();

    let refreshed: Awaited<ReturnType<typeof handle.result.current.refresh>> | undefined;
    await act(async () => {
      refreshed = await handle.result.current.refresh();
    });

    assert.equal(refreshed?.free.id, "free");
    assert.equal(refreshed?.pricing.amountCents, 2490);

    handle.unmount();
  });
});

// ─── Cache de curta duração ───

describe("usePlans - cache", () => {
  test("remontagem dentro do TTL reutiliza o cache sem novo fetch", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse(plansPayload())) as unknown as typeof fetch;

    const first = renderHook(usePlans);
    await flush();
    first.unmount();
    assert.equal(fetchCallCount(), 1);

    const second = renderHook(usePlans);
    // Com cache fresco o estado inicial já vem preenchido (o sync() do efeito
    // liga loading de qualquer forma, mas resolve do cache sem novo fetch).
    assert.equal(second.result.current.plans?.pro.id, "pro");

    await flush();
    assert.equal(second.result.current.loading, false);
    assert.equal(fetchCallCount(), 1);

    second.unmount();
  });
});

// ─── Eventos ───

describe("usePlans - eventos", () => {
  test("evento grabix:plans-changed invalida o cache e refaz o fetch", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse(plansPayload())) as unknown as typeof fetch;

    const handle = renderHook(usePlans);
    await flush();
    assert.equal(fetchCallCount(), 1);

    act(() => {
      win.dispatchEvent(new Event("grabix:plans-changed"));
    });
    await flush();

    assert.equal(fetchCallCount(), 2);

    handle.unmount();
  });

  test("focus com cache fresco não refaz o fetch", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse(plansPayload())) as unknown as typeof fetch;

    const handle = renderHook(usePlans);
    await flush();

    act(() => {
      win.dispatchEvent(new Event("focus"));
    });
    await flush();

    assert.equal(fetchCallCount(), 1);

    handle.unmount();
  });

  test("focus com cache invalidado refaz o fetch", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse(plansPayload())) as unknown as typeof fetch;

    const handle = renderHook(usePlans);
    await flush();

    invalidatePlansCache();
    act(() => {
      win.dispatchEvent(new Event("focus"));
    });
    await flush();

    assert.equal(fetchCallCount(), 2);

    handle.unmount();
  });

  test("unmount remove os listeners de focus e plans-changed", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse(plansPayload())) as unknown as typeof fetch;

    const handle = renderHook(usePlans);
    await flush();
    handle.unmount();
    invalidatePlansCache();

    act(() => {
      win.dispatchEvent(new Event("focus"));
      win.dispatchEvent(new Event("grabix:plans-changed"));
    });
    await flush();

    assert.equal(fetchCallCount(), 1);
  });
});
