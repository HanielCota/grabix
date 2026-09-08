import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { startCheckout, takeCheckoutContext } from "../../src/lib/billing/checkout.ts";

const CHECKOUT_CONTEXT_KEY = "grabix:checkout-context:v1";
const ATTRIBUTION_KEY = "grabix:attribution:v1";

interface FakeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  data: Map<string, string>;
}

function makeStorage(
  initial: Record<string, string> = {},
  options: { throwOnGet?: boolean; throwOnSet?: boolean; throwOnRemove?: boolean } = {},
): FakeStorage {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      if (options.throwOnGet) throw new Error("storage bloqueado");
      return data.has(key) ? (data.get(key) as string) : null;
    },
    setItem(key, value) {
      if (options.throwOnSet) throw new Error("quota excedida");
      data.set(key, value);
    },
    removeItem(key) {
      if (options.throwOnRemove) throw new Error("storage bloqueado");
      data.delete(key);
    },
  };
}

interface FakeWindow {
  location: { pathname: string; search: string; origin: string; href: string };
  sessionStorage: FakeStorage;
  localStorage: FakeStorage;
  dataLayer: Array<Record<string, unknown>>;
}

interface InstallOptions {
  pathname?: string;
  search?: string;
  session?: Record<string, string>;
  sessionThrowsOnSet?: boolean;
  sessionThrowsOnGet?: boolean;
  sessionThrowsOnRemove?: boolean;
}

function installFakeWindow(options: InstallOptions = {}): FakeWindow {
  const fake: FakeWindow = {
    location: {
      pathname: options.pathname ?? "/precos",
      search: options.search ?? "",
      origin: "https://grabix.app",
      href: "https://grabix.app/precos",
    },
    sessionStorage: makeStorage(options.session ?? {}, {
      throwOnSet: options.sessionThrowsOnSet,
      throwOnGet: options.sessionThrowsOnGet,
      throwOnRemove: options.sessionThrowsOnRemove,
    }),
    localStorage: makeStorage(),
    dataLayer: [],
  };
  (globalThis as Record<string, unknown>).window = fake;
  return fake;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  return {
    ok,
    status: init.status ?? (ok ? 200 : 400),
    json: async () => body,
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

// ─── startCheckout: casos felizes ───

describe("startCheckout - sucesso", () => {
  test("redireciona para o init_point retornado pela API", async () => {
    const fake = installFakeWindow();
    globalThis.fetch = mock.fn(async () =>
      jsonResponse({ init_point: "https://mp.com/checkout/123" }),
    ) as unknown as typeof fetch;

    await startCheckout({ reason: "limite", returnTo: "/workspace" });

    assert.equal(fake.location.href, "https://mp.com/checkout/123");
  });

  test("envia POST JSON para /api/billing/subscribe com o contexto sanitizado", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ reason: "atingiu_limite", returnTo: "/historico" });

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    assert.equal(calls.length, 1);
    const [url, init] = calls[0].arguments as [string, RequestInit];
    assert.equal(url, "/api/billing/subscribe");
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(init.body as string), { reason: "atingiu_limite", returnTo: "/historico" });
  });

  test("salva o contexto no sessionStorage antes de chamar a API", async () => {
    const fake = installFakeWindow();
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ reason: "upsell", returnTo: "/workspace" });

    const saved = fake.sessionStorage.getItem(CHECKOUT_CONTEXT_KEY);
    assert.deepEqual(JSON.parse(saved as string), { reason: "upsell", returnTo: "/workspace" });
  });

  test("registra evento checkout_started com plan pro e página de origem", async () => {
    const fake = installFakeWindow({ pathname: "/precos" });
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ reason: "limite" });

    assert.equal(fake.dataLayer.length, 1);
    assert.deepEqual(fake.dataLayer[0], {
      event: "checkout_started",
      plan: "pro",
      upgrade_reason: "limite",
      source_page: "/precos",
    });
  });

  test("captura utm da URL no localStorage (attribution) antes de iniciar", async () => {
    const fake = installFakeWindow({ search: "?utm_source=google" });
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout();

    const saved = fake.localStorage.getItem(ATTRIBUTION_KEY);
    assert.deepEqual(JSON.parse(saved as string), { utm_source: "google" });
  });

  test("sem contexto, usa returnTo '/' e reason undefined", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout();

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    const body = JSON.parse((calls[0].arguments as [string, RequestInit])[1].body as string);
    assert.deepEqual(body, { returnTo: "/" });
    assert.equal("reason" in body ? body.reason : undefined, undefined);
  });
});

// ─── startCheckout: sanitização do contexto ───

describe("startCheckout - sanitização do contexto", () => {
  test("trunca reason em 80 caracteres", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ reason: "x".repeat(200) });

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    const body = JSON.parse((calls[0].arguments as [string, RequestInit])[1].body as string);
    assert.equal(body.reason.length, 80);
  });

  test("reason com exatamente 80 caracteres é preservado integralmente", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ reason: "y".repeat(80) });

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    const body = JSON.parse((calls[0].arguments as [string, RequestInit])[1].body as string);
    assert.equal(body.reason, "y".repeat(80));
  });

  test("reason que não é string vira undefined", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ reason: 123 as unknown as string });

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    const body = JSON.parse((calls[0].arguments as [string, RequestInit])[1].body as string);
    assert.equal(body.reason, undefined);
  });

  test("returnTo externo (URL absoluta) é substituído por '/'", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ returnTo: "https://evil.com/phishing" });

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    const body = JSON.parse((calls[0].arguments as [string, RequestInit])[1].body as string);
    assert.equal(body.returnTo, "/");
  });

  test("returnTo protocol-relative ('//evil.com') não começa com '/' simples e é aceito pela checagem", async () => {
    // Comportamento real: startsWith("/") aceita "//evil.com" — documentado aqui como é.
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ returnTo: "//evil.com" });

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    const body = JSON.parse((calls[0].arguments as [string, RequestInit])[1].body as string);
    assert.equal(body.returnTo, "//evil.com");
  });

  test("returnTo undefined vira '/'", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ reason: "x" });

    const calls = (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.calls;
    const body = JSON.parse((calls[0].arguments as [string, RequestInit])[1].body as string);
    assert.equal(body.returnTo, "/");
  });
});

// ─── startCheckout: resiliência e erros ───

describe("startCheckout - erros e resiliência", () => {
  test("lança Error com a mensagem da API quando res.ok é falso", async () => {
    globalThis.fetch = mock.fn(async () =>
      jsonResponse({ error: { message: "Assinatura já ativa." } }, { ok: false, status: 409 }),
    ) as unknown as typeof fetch;

    await assert.rejects(() => startCheckout(), /Assinatura já ativa\./);
  });

  test("lança mensagem padrão quando a API não devolve error.message", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({}, { ok: false, status: 500 })) as unknown as typeof fetch;

    await assert.rejects(() => startCheckout(), /Não foi possível iniciar a assinatura/);
  });

  test("lança mensagem padrão quando o corpo não é JSON válido", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })) as unknown as typeof fetch;

    await assert.rejects(() => startCheckout(), /Não foi possível iniciar a assinatura/);
  });

  test("lança mensagem padrão quando res.ok é true mas falta init_point", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ something: "else" })) as unknown as typeof fetch;

    await assert.rejects(() => startCheckout(), /Não foi possível iniciar a assinatura/);
  });

  test("propaga erro de rede do fetch", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await assert.rejects(() => startCheckout(), /fetch failed/);
  });

  test("continua o fluxo mesmo quando sessionStorage.setItem lança", async () => {
    const fake = installFakeWindow({ sessionThrowsOnSet: true });
    globalThis.fetch = mock.fn(async () => jsonResponse({ init_point: "https://mp.com/x" })) as unknown as typeof fetch;

    await startCheckout({ reason: "x", returnTo: "/w" });
    assert.equal(fake.location.href, "https://mp.com/x");
  });
});

// ─── takeCheckoutContext ───

describe("takeCheckoutContext", () => {
  test("retorna o contexto salvo e o remove do sessionStorage", () => {
    const fake = installFakeWindow({
      session: { [CHECKOUT_CONTEXT_KEY]: JSON.stringify({ reason: "limite", returnTo: "/workspace" }) },
    });

    const context = takeCheckoutContext();

    assert.deepEqual(context, { reason: "limite", returnTo: "/workspace" });
    assert.equal(fake.sessionStorage.getItem(CHECKOUT_CONTEXT_KEY), null, "deve remover após ler");
  });

  test("retorna {} quando não há contexto salvo", () => {
    installFakeWindow();
    assert.deepEqual(takeCheckoutContext(), {});
  });

  test("retorna {} quando o valor salvo não é JSON válido", () => {
    installFakeWindow({ session: { [CHECKOUT_CONTEXT_KEY]: "{quebrado" } });
    assert.deepEqual(takeCheckoutContext(), {});
  });

  test("retorna {} quando o valor salvo não é um objeto", () => {
    for (const value of ["42", '"texto"', "null", "true"]) {
      installFakeWindow({ session: { [CHECKOUT_CONTEXT_KEY]: value } });
      assert.deepEqual(takeCheckoutContext(), {}, `valor: ${value}`);
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  test("JSON de array passa na checagem typeof object e é retornado como está", () => {
    // Comportamento real: a validação é apenas `typeof parsed === "object"`,
    // então um array JSON não é rejeitado (quirk inofensivo — nunca é gravado assim).
    installFakeWindow({ session: { [CHECKOUT_CONTEXT_KEY]: "[1,2]" } });
    assert.deepEqual(takeCheckoutContext(), [1, 2]);
  });

  test("retorna {} quando sessionStorage.getItem lança exceção", () => {
    installFakeWindow({ sessionThrowsOnGet: true });
    assert.deepEqual(takeCheckoutContext(), {});
  });

  test("retorna {} quando sessionStorage.removeItem lança exceção", () => {
    installFakeWindow({
      session: { [CHECKOUT_CONTEXT_KEY]: JSON.stringify({ reason: "x" }) },
      sessionThrowsOnRemove: true,
    });
    assert.deepEqual(takeCheckoutContext(), {});
  });

  test("segunda leitura consecutiva retorna {} (contexto consumido)", () => {
    installFakeWindow({
      session: { [CHECKOUT_CONTEXT_KEY]: JSON.stringify({ reason: "limite" }) },
    });

    assert.deepEqual(takeCheckoutContext(), { reason: "limite" });
    assert.deepEqual(takeCheckoutContext(), {});
  });
});
