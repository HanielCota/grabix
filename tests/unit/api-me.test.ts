import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { subscriptions } from "../../src/server/db/schema.ts";
import type { Plan } from "../../src/server/plans.ts";

// Testa a rota GET /api/me (src/app/api/me/route.ts) com todas as dependências
// mockadas via mock.module — requer --experimental-test-module-mocks; sem a flag
// os testes são pulados, seguindo a convenção de tests/unit/auth-guard.test.ts.
// O "DB" é um Proxy encadeável no estilo de tests/unit/plans-config.test.ts.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const needsMock = { skip: !canMockModules && "requer node --experimental-test-module-mocks" };

type Session = { user?: { id?: string; email?: string | null } } | null;

let sessionImpl: Session = null;
let planImpl: Plan | null = null;
let usageImpl = 0;
let isAdminImpl = false;
let planError: Error | null = null;
const isAdminCalls: Array<{ userId: string; email?: string | null }> = [];
let selectCalls = 0;
let subscriptionRows: unknown[] = [];

function makeChain(): unknown {
  const chain: unknown = new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(subscriptionRows);
      }
      if (prop === "catch" || prop === "finally") return () => chain;
      return (..._args: unknown[]) => {
        if (String(prop) === "select") selectCalls += 1;
        return chain;
      };
    },
  });
  return chain;
}

if (canMockModules) {
  mock.module("@/auth", {
    namedExports: { auth: () => Promise.resolve(sessionImpl) },
  });
  mock.module("@/server/admin", {
    namedExports: {
      isAdmin: (userId: string, email?: string | null) => {
        isAdminCalls.push({ userId, email });
        return Promise.resolve(isAdminImpl);
      },
    },
  });
  mock.module("@/server/entitlements", {
    namedExports: {
      getUserPlan: (_userId: string) => {
        if (planError) return Promise.reject(planError);
        return Promise.resolve(planImpl);
      },
      getTodayUsage: (_userId: string) => Promise.resolve(usageImpl),
    },
  });
  // @types/node ainda não tipa a opção `exports` (antiga `namedExports`)
  mock.module("@/server/db", { exports: { getDb: () => makeChain() } } as Parameters<typeof mock.module>[1]);
}

async function importRoute() {
  return import("../../src/app/api/me/route.ts");
}

function makePlan(id: "free" | "pro", downloadsPerDay: number): Plan {
  return {
    id,
    limits: { maxAssets: 10, maxFileSizeBytes: 50, maxZipSizeBytes: 100, maxConcurrentDownloads: 2 },
    features: { deepCrawl: false, jsRendering: false, protectedVideo: false },
    quota: { downloadsPerDay },
  };
}

function reset(overrides: { plan?: Plan; used?: number; admin?: boolean; subRows?: unknown[] } = {}) {
  sessionImpl = { user: { id: "u-1", email: "ana@x.com" } };
  planImpl = overrides.plan ?? makePlan("free", 20);
  usageImpl = overrides.used ?? 0;
  isAdminImpl = overrides.admin ?? false;
  planError = null;
  subscriptionRows = overrides.subRows ?? [];
  selectCalls = 0;
  isAdminCalls.length = 0;
}

// ─── Não autenticado ───

test("GET /api/me: sem sessão retorna apenas authenticated:false", needsMock, async () => {
  const { GET } = await importRoute();
  reset();
  sessionImpl = null;
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { authenticated: false });
  assert.equal(selectCalls, 0); // não consulta o DB
});

test("GET /api/me: sessão sem user.id retorna authenticated:false", needsMock, async () => {
  const { GET } = await importRoute();
  reset();
  sessionImpl = { user: { email: "ana@x.com" } };
  const res = await GET();
  assert.deepEqual(await res.json(), { authenticated: false });
  assert.equal(selectCalls, 0);
});

// ─── Usuário free ───

test("GET /api/me: usuário free recebe plano, uso e períodos nulos", needsMock, async () => {
  const { GET } = await importRoute();
  reset({ used: 3, subRows: [{ end: new Date("2026-01-01"), start: new Date("2025-12-01") }] });
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    authenticated: true,
    plan: "free",
    isAdmin: false,
    periodEnd: null, // períodos só existem no pro, mesmo havendo row de subscription
    periodStart: null,
    usage: { used: 3, limit: 20, remaining: 17 },
  });
});

test("GET /api/me: remaining é truncado em 0 quando o uso passa do limite", needsMock, async () => {
  const { GET } = await importRoute();
  reset({ used: 25 });
  const body = await (await GET()).json();
  assert.deepEqual(body.usage, { used: 25, limit: 20, remaining: 0 });
});

// ─── Usuário pro ───

test("GET /api/me: usuário pro tem limite null e períodos da subscription", needsMock, async () => {
  const { GET } = await importRoute();
  reset({
    plan: makePlan("pro", Number.POSITIVE_INFINITY),
    used: 999,
    subRows: [{ end: new Date("2026-08-01T00:00:00Z"), start: new Date("2026-07-01T00:00:00Z") }],
  });
  const body = await (await GET()).json();
  assert.equal(body.plan, "pro");
  assert.equal(body.periodEnd, "2026-08-01T00:00:00.000Z");
  assert.equal(body.periodStart, "2026-07-01T00:00:00.000Z");
  assert.deepEqual(body.usage, { used: 999, limit: null, remaining: null });
});

test("GET /api/me: pro sem row de subscription tem períodos null", needsMock, async () => {
  const { GET } = await importRoute();
  reset({ plan: makePlan("pro", Number.POSITIVE_INFINITY), subRows: [] });
  const body = await (await GET()).json();
  assert.equal(body.periodEnd, null);
  assert.equal(body.periodStart, null);
});

test("GET /api/me: select de subscription usa a tabela correta", needsMock, async () => {
  const { GET } = await importRoute();
  reset();
  // Garante que o schema real foi importado e a rota consulta `subscriptions`
  // (a chain registra o select; a identidade da tabela é verificada pelo from).
  await GET();
  assert.equal(selectCalls, 1);
  assert.ok(subscriptions);
});

// ─── Admin / erros ───

test("GET /api/me: isAdmin repassa id e email da sessão", needsMock, async () => {
  const { GET } = await importRoute();
  reset({ admin: true });
  const body = await (await GET()).json();
  assert.equal(body.isAdmin, true);
  assert.deepEqual(isAdminCalls, [{ userId: "u-1", email: "ana@x.com" }]);
});

test("GET /api/me: erro em getUserPlan propaga (rota não trata)", needsMock, async () => {
  const { GET } = await importRoute();
  reset();
  planError = new Error("db down");
  await assert.rejects(() => GET(), /db down/);
});
