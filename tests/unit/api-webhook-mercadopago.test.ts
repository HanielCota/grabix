import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { users, webhookEvents } from "../../src/server/db/schema.ts";

// Testa a rota POST /api/webhooks/mercadopago
// (src/app/api/webhooks/mercadopago/route.ts): verificação de assinatura,
// idempotência, gate de preço e aplicação de entitlement. A assinatura HMAC em
// si é coberta por tests/unit/mercadopago-webhook.test.ts; aqui
// verifyWebhookSignature é mockado junto com DB, MP, entitlements e pricing.
// mp-entitlement (mapeamento puro) e o schema do drizzle são reais.
// Requer --experimental-test-module-mocks.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const needsMock = { skip: !canMockModules && "requer node --experimental-test-module-mocks" };

type Payment = {
  id: number | string;
  status: string;
  external_reference?: string;
  payer?: { email?: string };
  transaction_amount?: number;
  currency_id?: string;
};
type Preapproval = {
  id: string;
  status: string;
  external_reference?: string;
  payer_email?: string;
  next_payment_date?: string;
  auto_recurring?: { transaction_amount?: number; currency_id?: string };
};

let verifyImpl = true;
const verifyCalls: Array<{ signature: string | null; requestId: string | null; dataId: string }> = [];
let paymentImpl: Payment | null = null;
let preapprovalImpl: Preapproval | null = null;
let authorizedPaymentImpl: { preapproval_id?: string; status?: string } = {};
const mpCalls: Array<{ fn: string; id: string }> = [];

let webhookEventsRows: unknown[] = [];
let usersSelectQueue: unknown[][] = [];
const insertCalls: Array<{ table: unknown; values: unknown }> = [];

let upsertCalls: Array<{ userId: string; data: Record<string, unknown> }> = [];
let pendingCalls: Array<{ email: string; data: Record<string, unknown> }> = [];
let pricingImpl = { amountCents: 1990, label: "R$ 19,90/mês" };

function makeChain(): unknown {
  const state: { table?: unknown } = {};
  const chain: unknown = new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => {
          if (state.table === webhookEvents) return resolve(webhookEventsRows);
          if (state.table === users) {
            const rows = usersSelectQueue.length > 1 ? usersSelectQueue.shift() : usersSelectQueue[0];
            return resolve(rows ?? []);
          }
          return resolve([]);
        };
      }
      if (prop === "catch" || prop === "finally") return () => chain;
      return (...args: unknown[]) => {
        const method = String(prop);
        if (method === "from" || method === "insert") state.table = args[0];
        if (method === "values") insertCalls.push({ table: state.table, values: args[0] });
        return chain;
      };
    },
  });
  return chain;
}

if (canMockModules) {
  mock.module("@/server/mercadopago", {
    namedExports: {
      verifyWebhookSignature: (opts: { signature: string | null; requestId: string | null; dataId: string }) => {
        verifyCalls.push(opts);
        return verifyImpl;
      },
      getPayment: (id: string) => {
        mpCalls.push({ fn: "getPayment", id });
        return Promise.resolve(paymentImpl);
      },
      getPreapproval: (id: string) => {
        mpCalls.push({ fn: "getPreapproval", id });
        return Promise.resolve(preapprovalImpl);
      },
      getAuthorizedPayment: (id: string) => {
        mpCalls.push({ fn: "getAuthorizedPayment", id });
        return Promise.resolve(authorizedPaymentImpl);
      },
    },
  });
  mock.module("@/server/entitlements", {
    namedExports: {
      upsertSubscription: (userId: string, data: Record<string, unknown>) => {
        upsertCalls.push({ userId, data });
        return Promise.resolve();
      },
      addPendingEntitlement: (email: string, data: Record<string, unknown>) => {
        pendingCalls.push({ email, data });
        return Promise.resolve();
      },
    },
  });
  mock.module("@/server/plans-config", {
    namedExports: { getEffectivePricing: () => Promise.resolve(pricingImpl) },
  });
  // @types/node ainda não tipa a opção `exports` (antiga `namedExports`)
  mock.module("@/server/db", { exports: { getDb: () => makeChain() } } as Parameters<typeof mock.module>[1]);
}

async function importRoute() {
  return import("../../src/app/api/webhooks/mercadopago/route.ts");
}

const VALID_HEADERS = { "x-signature": "ts=1,v1=abc", "x-request-id": "req-1" };

function makeRequest(options: {
  body?: unknown;
  invalidJson?: boolean;
  search?: string;
  headers?: Record<string, string>;
}): NextRequest {
  return {
    nextUrl: new URL(`https://grabix.app/api/webhooks/mercadopago${options.search ?? ""}`),
    headers: new Headers(options.headers ?? VALID_HEADERS),
    json: () =>
      options.invalidJson ? Promise.reject(new SyntaxError("Unexpected token")) : Promise.resolve(options.body ?? {}),
  } as unknown as NextRequest;
}

function paymentRequest(payment: Payment = APPROVED_PAYMENT, headers: Record<string, string> = VALID_HEADERS) {
  return makeRequest({ body: { type: "payment", data: { id: String(payment.id) } }, headers });
}

function reset() {
  verifyImpl = true;
  verifyCalls.length = 0;
  paymentImpl = APPROVED_PAYMENT;
  preapprovalImpl = null;
  authorizedPaymentImpl = {};
  mpCalls.length = 0;
  webhookEventsRows = [];
  usersSelectQueue = [[{ id: "u-1", email: "ana@x.com" }]];
  insertCalls.length = 0;
  upsertCalls = [];
  pendingCalls = [];
  pricingImpl = { amountCents: 1990, label: "R$ 19,90/mês" };
}

const APPROVED_PAYMENT: Payment = {
  id: 123,
  status: "approved",
  external_reference: "u-1",
  payer: { email: "ana@x.com" },
  transaction_amount: 19.9,
  currency_id: "BRL",
};

const AUTHORIZED_PRE: Preapproval = {
  id: "pre-1",
  status: "authorized",
  external_reference: "u-1",
  payer_email: "ana@x.com",
  next_payment_date: "2026-08-01T00:00:00.000Z",
  auto_recurring: { transaction_amount: 19.9, currency_id: "BRL" },
};

// ─── Validação da requisição ───

test("webhook MP: sem data.id responde 200 sem verificar assinatura", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  const res = await POST(makeRequest({ body: { type: "payment" } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, note: "sem data.id" });
  assert.equal(verifyCalls.length, 0);
});

test("webhook MP: assinatura inválida retorna 401 e não consulta o MP", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  verifyImpl = false;
  const res = await POST(paymentRequest());
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, "INVALID_SIGNATURE");
  assert.equal(mpCalls.length, 0);
  assert.equal(upsertCalls.length, 0);
});

test("webhook MP: assinatura é verificada com data.id, x-signature e x-request-id", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  await POST(paymentRequest());
  assert.deepEqual(verifyCalls, [{ signature: "ts=1,v1=abc", requestId: "req-1", dataId: "123" }]);
});

test("webhook MP: corpo não-JSON cai nos query params (type + data.id)", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  const res = await POST(makeRequest({ invalidJson: true, search: "?type=payment&data.id=123" }));
  assert.equal(res.status, 200);
  assert.deepEqual(mpCalls[0], { fn: "getPayment", id: "123" });
});

// ─── Pagamento único (topic = payment) ───

test("webhook MP: pagamento aprovado ativa Pro via external_reference", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  const res = await POST(paymentRequest());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, applied: "user:ref", status: "approved" });
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].userId, "u-1");
  assert.equal(upsertCalls[0].data.plan, "pro");
  assert.equal(upsertCalls[0].data.status, "active");
  assert.equal(upsertCalls[0].data.provider, "mercadopago");
  assert.equal(upsertCalls[0].data.externalId, "123");
  assert.ok(upsertCalls[0].data.currentPeriodEnd instanceof Date);
  // evento marcado como processado com a chave do x-request-id
  assert.deepEqual(insertCalls, [{ table: webhookEvents, values: { id: "req-1", provider: "mercadopago" } }]);
});

test("webhook MP: sem x-request-id a chave sintética inclui o status", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  await POST(paymentRequest(APPROVED_PAYMENT, { "x-signature": "ts=1,v1=abc" }));
  assert.deepEqual(insertCalls[0].values, { id: "payment:123:approved", provider: "mercadopago" });
});

test("webhook MP: pagamento aprovado abaixo do preço não libera Pro", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  paymentImpl = { ...APPROVED_PAYMENT, transaction_amount: 1.0 };
  const res = await POST(paymentRequest());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: "approved", note: "amount_mismatch" });
  assert.equal(upsertCalls.length, 0);
  assert.equal(pendingCalls.length, 0);
  assert.equal(insertCalls.length, 1); // marcado para não reprocessar
});

test("webhook MP: pagamento em moeda estrangeira não libera Pro", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  paymentImpl = { ...APPROVED_PAYMENT, transaction_amount: 100, currency_id: "USD" };
  const res = await POST(paymentRequest());
  assert.deepEqual(await res.json(), { ok: true, status: "approved", note: "amount_mismatch" });
  assert.equal(upsertCalls.length, 0);
});

test("webhook MP: pagamento pendente não gera entitlement mas é marcado", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  paymentImpl = { ...APPROVED_PAYMENT, status: "pending" };
  const res = await POST(paymentRequest());
  assert.deepEqual(await res.json(), { ok: true, status: "pending" });
  assert.equal(upsertCalls.length, 0);
  assert.equal(insertCalls.length, 1);
});

test("webhook MP: reembolso revoga Pro sem gate de preço", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  // sem transaction_amount: revogações nunca são barradas pelo gate de preço
  paymentImpl = { id: 123, status: "refunded", external_reference: "u-1", payer: { email: "ana@x.com" } };
  const res = await POST(paymentRequest());
  assert.deepEqual(await res.json(), { ok: true, applied: "user:ref", status: "refunded" });
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].data.status, "refunded");
  assert.equal(upsertCalls[0].data.currentPeriodEnd, null);
});

test("webhook MP: evento duplicado é absorvido sem reaplicar entitlement", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  webhookEventsRows = [{ id: "req-1" }];
  const res = await POST(paymentRequest());
  assert.deepEqual(await res.json(), { ok: true, duplicate: true });
  assert.deepEqual(mpCalls, [{ fn: "getPayment", id: "123" }]);
  assert.equal(upsertCalls.length, 0);
  assert.equal(insertCalls.length, 0);
});

// ─── Resolução do usuário (fallback) ───

test("webhook MP: sem match por external_reference cai no e-mail do pagador", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  usersSelectQueue = [[], [{ id: "u-9", email: "ana@x.com" }]];
  const res = await POST(paymentRequest());
  assert.deepEqual(await res.json(), { ok: true, applied: "user:email", status: "approved" });
  assert.equal(upsertCalls[0].userId, "u-9");
});

test("webhook MP: sem usuário, pagamento aprovado vira entitlement pendente", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  usersSelectQueue = [[], []];
  paymentImpl = { ...APPROVED_PAYMENT, external_reference: "desconhecido", payer: { email: "ANA@X.com" } };
  const res = await POST(paymentRequest());
  assert.deepEqual(await res.json(), { ok: true, applied: "pending", status: "approved" });
  assert.equal(upsertCalls.length, 0);
  assert.equal(pendingCalls.length, 1);
  assert.equal(pendingCalls[0].email, "ana@x.com"); // normalizado para minúsculas
});

test("webhook MP: sem referência nem e-mail o evento fica unmatched", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  usersSelectQueue = [];
  paymentImpl = { id: 123, status: "approved", transaction_amount: 19.9, currency_id: "BRL" };
  const res = await POST(paymentRequest());
  assert.deepEqual(await res.json(), { ok: true, applied: "unmatched", status: "approved" });
  assert.equal(upsertCalls.length, 0);
  assert.equal(pendingCalls.length, 0);
});

// ─── Tópicos ignorados ───

test("webhook MP: tópico desconhecido é ignorado e marcado como processado", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  const res = await POST(makeRequest({ body: { type: "merchant_order", data: { id: "m-1" } } }));
  assert.deepEqual(await res.json(), { ok: true, ignored: "merchant_order" });
  assert.equal(mpCalls.length, 0);
  assert.deepEqual(insertCalls, [{ table: webhookEvents, values: { id: "req-1", provider: "mercadopago" } }]);
});

// ─── Assinatura recorrente (preapproval) ───

test("webhook MP: preapproval autorizado ativa Pro", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  preapprovalImpl = AUTHORIZED_PRE;
  const res = await POST(makeRequest({ body: { type: "preapproval", data: { id: "pre-1" } } }));
  assert.deepEqual(await res.json(), { ok: true, applied: "user:ref", status: "authorized" });
  assert.deepEqual(mpCalls, [{ fn: "getPreapproval", id: "pre-1" }]);
  assert.equal(upsertCalls[0].data.status, "active");
  assert.equal(upsertCalls[0].data.externalId, "pre-1");
});

test("webhook MP: preapproval cancelado revoga sem gate de preço", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  preapprovalImpl = { ...AUTHORIZED_PRE, status: "cancelled", next_payment_date: undefined };
  const res = await POST(makeRequest({ body: { type: "preapproval", data: { id: "pre-1" } } }));
  assert.deepEqual(await res.json(), { ok: true, applied: "user:ref", status: "cancelled" });
  assert.equal(upsertCalls[0].data.status, "canceled");
});

test("webhook MP: preapproval com valor recorrente abaixo do preço não libera Pro", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  preapprovalImpl = {
    ...AUTHORIZED_PRE,
    auto_recurring: { transaction_amount: 5, currency_id: "BRL" },
  };
  const res = await POST(makeRequest({ body: { type: "preapproval", data: { id: "pre-1" } } }));
  assert.deepEqual(await res.json(), { ok: true, status: "authorized", note: "amount_mismatch" });
  assert.equal(upsertCalls.length, 0);
});

test("webhook MP: authorized_payment resolve o preapproval encadeado", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  authorizedPaymentImpl = { preapproval_id: "pre-1", status: "processed" };
  preapprovalImpl = AUTHORIZED_PRE;
  const res = await POST(makeRequest({ body: { type: "authorized_payment", data: { id: "ap-1" } } }));
  assert.deepEqual(await res.json(), { ok: true, applied: "user:ref", status: "authorized" });
  assert.deepEqual(mpCalls, [
    { fn: "getAuthorizedPayment", id: "ap-1" },
    { fn: "getPreapproval", id: "pre-1" },
  ]);
});

test("webhook MP: authorized_payment sem preapproval_id é ignorado", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  authorizedPaymentImpl = { status: "processed" }; // sem preapproval_id
  const res = await POST(makeRequest({ body: { type: "authorized_payment", data: { id: "ap-1" } } }));
  assert.deepEqual(await res.json(), { ok: true, ignored: "authorized_payment" });
  assert.deepEqual(mpCalls, [{ fn: "getAuthorizedPayment", id: "ap-1" }]);
});
