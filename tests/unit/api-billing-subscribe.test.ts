import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// Testa a rota POST /api/billing/subscribe (src/app/api/billing/subscribe/route.ts)
// com auth-guard, Mercado Pago e plans-config mockados; handleApiError e AppError
// são reais. Requer --experimental-test-module-mocks.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const needsMock = { skip: !canMockModules && "requer node --experimental-test-module-mocks" };

type User = { id: string; email?: string | null };
type PreferenceParams = {
  userId: string;
  payerEmail: string;
  amount: number;
  backUrl: string;
  notificationUrl?: string;
};

let userImpl: User | null = { id: "u-1", email: "ana@x.com" };
let authError: Error | null = null;
let pricingImpl = { amountCents: 1990, label: "R$ 19,90/mês" };
let pricingError: Error | null = null;
let preferenceResult = { id: "pref-1", initPoint: "https://mp.com/checkout/pref-1" };
let preferenceError: Error | null = null;
const preferenceCalls: PreferenceParams[] = [];

if (canMockModules) {
  mock.module("@/server/auth-guard", {
    namedExports: {
      requireUser: () => {
        if (authError) return Promise.reject(authError);
        return Promise.resolve(userImpl);
      },
    },
  });
  mock.module("@/server/plans-config", {
    namedExports: {
      getEffectivePricing: () => {
        if (pricingError) return Promise.reject(pricingError);
        return Promise.resolve(pricingImpl);
      },
    },
  });
  mock.module("@/server/mercadopago", {
    namedExports: {
      createCheckoutPreference: (params: PreferenceParams) => {
        preferenceCalls.push(params);
        if (preferenceError) return Promise.reject(preferenceError);
        return Promise.resolve(preferenceResult);
      },
    },
  });
}

async function importRoute() {
  return import("../../src/app/api/billing/subscribe/route.ts");
}

function makeRequest(body: unknown, options: { invalidJson?: boolean } = {}): NextRequest {
  return {
    nextUrl: new URL("https://grabix.app/api/billing/subscribe"),
    headers: new Headers(),
    json: () => (options.invalidJson ? Promise.reject(new SyntaxError("Unexpected token")) : Promise.resolve(body)),
  } as unknown as NextRequest;
}

function reset() {
  userImpl = { id: "u-1", email: "ana@x.com" };
  authError = null;
  pricingImpl = { amountCents: 1990, label: "R$ 19,90/mês" };
  pricingError = null;
  preferenceResult = { id: "pref-1", initPoint: "https://mp.com/checkout/pref-1" };
  preferenceError = null;
  preferenceCalls.length = 0;
}

// ─── Caminho feliz ───

test("POST /api/billing/subscribe: cria preferência e retorna o init_point", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  const res = await POST(makeRequest({}));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { init_point: "https://mp.com/checkout/pref-1" });
  assert.equal(preferenceCalls.length, 1);
  const params = preferenceCalls[0];
  assert.equal(params.userId, "u-1"); // external_reference = userId
  assert.equal(params.payerEmail, "ana@x.com");
  assert.equal(params.amount, 19.9); // centavos → reais
  assert.equal(params.notificationUrl, "https://grabix.app/api/webhooks/mercadopago");
});

test("POST /api/billing/subscribe: backUrl usa o origin e returnTo padrão '/'", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  await POST(makeRequest({}));
  assert.equal(preferenceCalls[0].backUrl, "https://grabix.app/billing/return?returnTo=%2F");
});

test("POST /api/billing/subscribe: returnTo interno é preservado e URL-encodado", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  await POST(makeRequest({ returnTo: "/historico?aba=1" }));
  assert.equal(preferenceCalls[0].backUrl, "https://grabix.app/billing/return?returnTo=%2Fhistorico%3Faba%3D1");
});

test("POST /api/billing/subscribe: converte preço customizado para reais", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  pricingImpl = { amountCents: 4990, label: "R$ 49,90/mês" };
  await POST(makeRequest({}));
  assert.equal(preferenceCalls[0].amount, 49.9);
});

// ─── Autenticação / e-mail ───

test("POST /api/billing/subscribe: sem sessão retorna 401 e não chama o MP", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  authError = new AppError("Faça login para continuar.", "UNAUTHORIZED", 401);
  const res = await POST(makeRequest({}));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "UNAUTHORIZED");
  assert.equal(preferenceCalls.length, 0);
});

test("POST /api/billing/subscribe: conta sem e-mail retorna 402 e não chama o MP", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  userImpl = { id: "u-2", email: null };
  const res = await POST(makeRequest({}));
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.error.code, "UPGRADE_REQUIRED");
  assert.match(body.error.message, /e-mail/);
  assert.equal(preferenceCalls.length, 0);
});

// ─── returnTo malicioso / inválido ───

test("POST /api/billing/subscribe: returnTo absoluto (open redirect) cai para '/'", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  await POST(makeRequest({ returnTo: "https://evil.com/roubar" }));
  assert.equal(preferenceCalls[0].backUrl, "https://grabix.app/billing/return?returnTo=%2F");
});

test("POST /api/billing/subscribe: returnTo '//host' (scheme-relative) cai para '/'", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  await POST(makeRequest({ returnTo: "//evil.com" }));
  assert.equal(preferenceCalls[0].backUrl, "https://grabix.app/billing/return?returnTo=%2F");
});

test("POST /api/billing/subscribe: returnTo não-string cai para '/'", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  await POST(makeRequest({ returnTo: 42 }));
  assert.equal(preferenceCalls[0].backUrl, "https://grabix.app/billing/return?returnTo=%2F");
});

test("POST /api/billing/subscribe: returnTo é truncado em 500 caracteres", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  const long = `/${"a".repeat(600)}`;
  await POST(makeRequest({ returnTo: long }));
  const backUrl = new URL(preferenceCalls[0].backUrl);
  assert.equal(backUrl.searchParams.get("returnTo")?.length, 500);
});

test("POST /api/billing/subscribe: corpo não-JSON é tolerado e usa returnTo '/'", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  const res = await POST(makeRequest(null, { invalidJson: true }));
  assert.equal(res.status, 200);
  assert.equal(preferenceCalls[0].backUrl, "https://grabix.app/billing/return?returnTo=%2F");
});

// ─── Erros de dependência ───

test("POST /api/billing/subscribe: falha do MP preserva o AppError (503)", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  preferenceError = new AppError("Assinatura indisponível no momento.", "BILLING_UNAVAILABLE", 503);
  const res = await POST(makeRequest({}));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "BILLING_UNAVAILABLE");
});

test("POST /api/billing/subscribe: falha ao ler preço vira 500", needsMock, async () => {
  const { POST } = await importRoute();
  reset();
  pricingError = new Error("db down");
  const res = await POST(makeRequest({}));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error.code, "INTERNAL_ERROR");
  assert.equal(preferenceCalls.length, 0);
});
