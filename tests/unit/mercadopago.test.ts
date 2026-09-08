import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";
import {
  createCheckoutPreference,
  createPreapproval,
  getAuthorizedPayment,
  getPayment,
  getPreapproval,
} from "../../src/server/mercadopago.ts";

// verifyWebhookSignature já é coberto por tests/unit/mercadopago-webhook.test.ts.
// Aqui cobrimos as funções que falam com a API REST do Mercado Pago, com o
// fetch global substituído por um espião — nenhum teste toca a rede.

const TOKEN = "token-de-teste";

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
const originalAccessToken = process.env.MP_ACCESS_TOKEN;

let fetchImpl: FetchImpl = async () => jsonResponse({});
const fetchCalls: Array<{ url: string; init: RequestInit }> = [];

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  fetchCalls.push({ url: String(input), init: init ?? {} });
  return fetchImpl(input, init);
}) as typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function erroMp(status: number): Response {
  return jsonResponse({ message: "erro MP" }, status);
}

function ultimaChamada() {
  const call = fetchCalls.at(-1);
  assert.ok(call, "fetch deveria ter sido chamado");
  return call;
}

function bodyJson(call: { init: RequestInit }): Record<string, unknown> {
  assert.equal(typeof call.init.body, "string");
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

afterEach(() => {
  fetchCalls.length = 0;
  fetchImpl = async () => jsonResponse({});
  if (originalAccessToken === undefined) delete process.env.MP_ACCESS_TOKEN;
  else process.env.MP_ACCESS_TOKEN = originalAccessToken;
});

after(() => {
  globalThis.fetch = originalFetch;
});

// ─── Token de acesso ───

test("sem MP_ACCESS_TOKEN, lança AppError 503 antes de chamar a API", async () => {
  delete process.env.MP_ACCESS_TOKEN;
  const casos: Array<[string, () => Promise<unknown>]> = [
    [
      "createPreapproval",
      () => createPreapproval({ userId: "u", payerEmail: "a@b.com", amount: 10, backUrl: "https://x" }),
    ],
    [
      "createCheckoutPreference",
      () => createCheckoutPreference({ userId: "u", payerEmail: "a@b.com", amount: 10, backUrl: "https://x" }),
    ],
    ["getPreapproval", () => getPreapproval("p1")],
    ["getAuthorizedPayment", () => getAuthorizedPayment("a1")],
    ["getPayment", () => getPayment("123")],
  ];
  for (const [nome, fn] of casos) {
    const err = await fn().catch((e: unknown) => e);
    assert.ok(err instanceof AppError, nome);
    assert.equal(err.code, "BILLING_UNAVAILABLE", nome);
    assert.equal(err.statusCode, 503, nome);
  }
  assert.equal(fetchCalls.length, 0, "nenhuma chamada HTTP deve sair sem token");
});

// ─── createPreapproval ───

test("createPreapproval: POST /preapproval com payload de assinatura mensal", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => jsonResponse({ id: "pre-1", init_point: "https://mp.test/checkout" });

  const result = await createPreapproval({
    userId: "user-1",
    payerEmail: "pagador@example.com",
    amount: 19.9,
    backUrl: "https://grabix.test/assinatura/retorno",
  });

  assert.deepEqual(result, { id: "pre-1", initPoint: "https://mp.test/checkout" });

  const call = ultimaChamada();
  assert.equal(call.url, "https://api.mercadopago.com/preapproval");
  assert.equal(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(headers["Content-Type"], "application/json");

  assert.deepEqual(bodyJson(call), {
    reason: "Grabix Pro",
    external_reference: "user-1",
    payer_email: "pagador@example.com",
    back_url: "https://grabix.test/assinatura/retorno",
    status: "pending",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 19.9,
      currency_id: "BRL",
    },
  });
});

test("createPreapproval: usa sandbox_init_point quando init_point está ausente", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => jsonResponse({ id: "pre-2", sandbox_init_point: "https://sandbox.mp.test/checkout" });
  const result = await createPreapproval({ userId: "u", payerEmail: "a@b.com", amount: 10, backUrl: "https://x" });
  assert.equal(result.initPoint, "https://sandbox.mp.test/checkout");
});

test("createPreapproval: prefere init_point quando ambos estão presentes", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () =>
    jsonResponse({ id: "pre-3", init_point: "https://prod.mp.test", sandbox_init_point: "https://sandbox.mp.test" });
  const result = await createPreapproval({ userId: "u", payerEmail: "a@b.com", amount: 10, backUrl: "https://x" });
  assert.equal(result.initPoint, "https://prod.mp.test");
});

test("createPreapproval: sem link de checkout na resposta, lança AppError 502", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => jsonResponse({ id: "pre-4" });
  const err = await createPreapproval({ userId: "u", payerEmail: "a@b.com", amount: 10, backUrl: "https://x" }).catch(
    (e: unknown) => e,
  );
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "BILLING_ERROR");
  assert.equal(err.statusCode, 502);
  assert.match(err.message, /link de checkout/);
});

test("createPreapproval: resposta de erro do MP vira AppError 502 com o status", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => erroMp(400);
  const err = await createPreapproval({ userId: "u", payerEmail: "a@b.com", amount: 10, backUrl: "https://x" }).catch(
    (e: unknown) => e,
  );
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "BILLING_ERROR");
  assert.equal(err.statusCode, 502);
  assert.match(err.message, /MP 400/);
});

// ─── getPreapproval ───

test("getPreapproval: GET autenticado em /preapproval/:id retorna o JSON", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  const payload = { id: "pre-9", status: "authorized", external_reference: "user-1" };
  fetchImpl = async () => jsonResponse(payload);

  const result = await getPreapproval("pre-9");
  assert.deepEqual(result, payload);

  const call = ultimaChamada();
  assert.equal(call.url, "https://api.mercadopago.com/preapproval/pre-9");
  assert.equal(call.init.method, undefined, "GET é o método padrão");
  assert.equal((call.init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
});

test("getPreapproval: resposta de erro vira AppError 502", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => erroMp(404);
  const err = await getPreapproval("inexistente").catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "BILLING_ERROR");
  assert.equal(err.statusCode, 502);
  assert.match(err.message, /consultar assinatura \(MP 404\)/);
});

// ─── getAuthorizedPayment ───

test("getAuthorizedPayment: GET autenticado em /authorized_payments/:id", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  const payload = { preapproval_id: "pre-9", status: "processed" };
  fetchImpl = async () => jsonResponse(payload);

  const result = await getAuthorizedPayment("ap-55");
  assert.deepEqual(result, payload);
  assert.equal(ultimaChamada().url, "https://api.mercadopago.com/authorized_payments/ap-55");
});

test("getAuthorizedPayment: resposta de erro vira AppError 502", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => erroMp(500);
  const err = await getAuthorizedPayment("ap-55").catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 502);
  assert.match(err.message, /consultar pagamento \(MP 500\)/);
});

// ─── createCheckoutPreference ───

test("createCheckoutPreference: POST /checkout/preferences com item Pro em BRL", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => jsonResponse({ id: "pref-1", init_point: "https://mp.test/pref" });

  const result = await createCheckoutPreference({
    userId: "user-7",
    payerEmail: "comprador@example.com",
    amount: 19.9,
    backUrl: "https://grabix.test/pro/retorno",
  });

  assert.deepEqual(result, { id: "pref-1", initPoint: "https://mp.test/pref" });

  const call = ultimaChamada();
  assert.equal(call.url, "https://api.mercadopago.com/checkout/preferences");
  assert.equal(call.init.method, "POST");

  assert.deepEqual(bodyJson(call), {
    items: [
      {
        id: "grabix-pro",
        title: "Grabix Pro (1 mês)",
        quantity: 1,
        unit_price: 19.9,
        currency_id: "BRL",
      },
    ],
    payer: { email: "comprador@example.com" },
    external_reference: "user-7",
    back_urls: {
      success: "https://grabix.test/pro/retorno",
      failure: "https://grabix.test/pro/retorno",
      pending: "https://grabix.test/pro/retorno",
    },
    auto_return: "approved",
  });
});

test("createCheckoutPreference: inclui notification_url apenas quando informada", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => jsonResponse({ id: "pref-2", init_point: "https://mp.test/pref" });
  const base = { userId: "u", payerEmail: "a@b.com", amount: 10, backUrl: "https://x" };

  await createCheckoutPreference(base);
  assert.equal("notification_url" in bodyJson(ultimaChamada()), false, "sem notificationUrl, a chave não deve existir");

  await createCheckoutPreference({ ...base, notificationUrl: "https://grabix.test/api/webhooks/mp" });
  assert.equal(bodyJson(ultimaChamada()).notification_url, "https://grabix.test/api/webhooks/mp");
});

test("createCheckoutPreference: fallback para sandbox_init_point e erro sem link", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  const base = { userId: "u", payerEmail: "a@b.com", amount: 10, backUrl: "https://x" };

  fetchImpl = async () => jsonResponse({ id: "pref-3", sandbox_init_point: "https://sandbox.mp.test/pref" });
  const result = await createCheckoutPreference(base);
  assert.equal(result.initPoint, "https://sandbox.mp.test/pref");

  fetchImpl = async () => jsonResponse({ id: "pref-4" });
  const err = await createCheckoutPreference(base).catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 502);
  assert.match(err.message, /link de checkout/);
});

test("createCheckoutPreference: resposta de erro do MP vira AppError 502", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => erroMp(401);
  const err = await createCheckoutPreference({
    userId: "u",
    payerEmail: "a@b.com",
    amount: 10,
    backUrl: "https://x",
  }).catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "BILLING_ERROR");
  assert.match(err.message, /criar checkout \(MP 401\)/);
});

// ─── getPayment ───

test("getPayment: GET autenticado em /v1/payments/:id retorna o JSON", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  const payload = { id: 123, status: "approved", transaction_amount: 19.9, currency_id: "BRL" };
  fetchImpl = async () => jsonResponse(payload);

  const result = await getPayment("123");
  assert.deepEqual(result, payload);

  const call = ultimaChamada();
  assert.equal(call.url, "https://api.mercadopago.com/v1/payments/123");
  assert.equal((call.init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
});

test("getPayment: resposta de erro vira AppError 502", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = async () => erroMp(404);
  const err = await getPayment("999").catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 502);
  assert.match(err.message, /consultar pagamento \(MP 404\)/);
});

// ─── Timeout (fetchWithTimeout) ───

test("timeout do fetch vira AppError 504 'Timeout ao consultar Mercado Pago'", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.MP_ACCESS_TOKEN = TOKEN;
  fetchImpl = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });

  const promise = getPayment("123");
  const assertion = assert.rejects(
    promise,
    (e: unknown) =>
      e instanceof AppError && e.code === "BILLING_ERROR" && e.statusCode === 504 && /Timeout/.test(e.message),
  );
  t.mock.timers.tick(10_001); // MP_TIMEOUT_MS = 10s
  await assertion;
});

test("falha de rede genérica é propagada sem virar AppError", async () => {
  process.env.MP_ACCESS_TOKEN = TOKEN;
  const falha = new TypeError("fetch failed");
  fetchImpl = async () => {
    throw falha;
  };
  const err = await getPayment("123").catch((e: unknown) => e);
  assert.equal(err, falha, "erros que não são AbortError sobem intocados");
});
