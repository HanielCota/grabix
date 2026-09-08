import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { act, createElement, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { invalidatePricingCache, notifyPlansChanged, usePricing } from "../../src/hooks/use-pricing.ts";
import { PRICING } from "../../src/server/plans.ts";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const FALLBACK_LABEL = PRICING.proPriceLabel;

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
  invalidatePricingCache();
});

afterEach(() => {
  invalidatePricingCache();
  delete (globalThis as Record<string, unknown>).window;
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

// ─── Estado inicial e fetch ───

describe("usePricing - estado inicial e fetch", () => {
  test("inicia com o label de fallback antes da resposta", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ proPriceLabel: "R$ 29,90/mês" })) as unknown as typeof fetch;

    const handle = renderHook(usePricing);

    assert.equal(handle.result.current.proPriceLabel, FALLBACK_LABEL);

    await flush();
    handle.unmount();
  });

  test("atualiza o label após fetch bem-sucedido", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ proPriceLabel: "R$ 29,90/mês" })) as unknown as typeof fetch;

    const handle = renderHook(usePricing);
    await flush();

    assert.equal(handle.result.current.proPriceLabel, "R$ 29,90/mês");

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].arguments[0], "/api/pricing");

    handle.unmount();
  });

  test("label vazio ou ausente na resposta cai no fallback", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ proPriceLabel: "" })) as unknown as typeof fetch;

    const handle = renderHook(usePricing);
    await flush();

    assert.equal(handle.result.current.proPriceLabel, FALLBACK_LABEL);

    handle.unmount();
  });

  test("erro de rede mantém o fallback", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const handle = renderHook(usePricing);
    await flush();

    assert.equal(handle.result.current.proPriceLabel, FALLBACK_LABEL);

    handle.unmount();
  });

  test("falha não envenena o cache: focus posterior tenta de novo e atualiza", async () => {
    const win = installFakeWindow();
    let shouldFail = true;
    globalThis.fetch = mock.fn(async () => {
      if (shouldFail) throw new TypeError("fetch failed");
      return jsonResponse({ proPriceLabel: "R$ 24,90/mês" });
    }) as unknown as typeof fetch;

    const handle = renderHook(usePricing);
    await flush();
    assert.equal(handle.result.current.proPriceLabel, FALLBACK_LABEL);

    shouldFail = false;
    act(() => {
      win.dispatchEvent(new Event("focus"));
    });
    await flush();

    assert.equal(handle.result.current.proPriceLabel, "R$ 24,90/mês");
    assert.equal(fetchCallCount(), 2);

    handle.unmount();
  });
});

// ─── Cache e eventos ───

describe("usePricing - cache e eventos", () => {
  test("remontagem dentro do TTL reutiliza o cache sem novo fetch", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ proPriceLabel: "R$ 29,90/mês" })) as unknown as typeof fetch;

    const first = renderHook(usePricing);
    await flush();
    first.unmount();
    assert.equal(fetchCallCount(), 1);

    const second = renderHook(usePricing);
    assert.equal(second.result.current.proPriceLabel, "R$ 29,90/mês", "estado inicial já vem do cache");

    await flush();
    assert.equal(fetchCallCount(), 1);

    second.unmount();
  });

  test("focus com cache fresco não refaz o fetch", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse({ proPriceLabel: "R$ 29,90/mês" })) as unknown as typeof fetch;

    const handle = renderHook(usePricing);
    await flush();

    act(() => {
      win.dispatchEvent(new Event("focus"));
    });
    await flush();

    assert.equal(fetchCallCount(), 1);

    handle.unmount();
  });

  test("evento grabix:plans-changed invalida o cache e refaz o fetch", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse({ proPriceLabel: "R$ 29,90/mês" })) as unknown as typeof fetch;

    const handle = renderHook(usePricing);
    await flush();

    act(() => {
      win.dispatchEvent(new Event("grabix:plans-changed"));
    });
    await flush();

    assert.equal(fetchCallCount(), 2);

    handle.unmount();
  });

  test("unmount remove os listeners de focus e plans-changed", async () => {
    const win = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse({ proPriceLabel: "R$ 29,90/mês" })) as unknown as typeof fetch;

    const handle = renderHook(usePricing);
    await flush();
    handle.unmount();
    invalidatePricingCache();

    act(() => {
      win.dispatchEvent(new Event("focus"));
      win.dispatchEvent(new Event("grabix:plans-changed"));
    });
    await flush();

    assert.equal(fetchCallCount(), 1);
  });
});

// ─── notifyPlansChanged (função pura) ───

describe("notifyPlansChanged", () => {
  test("não lança quando window não existe", () => {
    delete (globalThis as Record<string, unknown>).window;
    assert.doesNotThrow(() => notifyPlansChanged());
  });

  test("dispara o evento grabix:plans-changed no window", () => {
    const win = installFakeWindow();
    const listener = mock.fn();
    win.addEventListener("grabix:plans-changed", listener);

    notifyPlansChanged();

    assert.equal(listener.mock.calls.length, 1);
  });
});
