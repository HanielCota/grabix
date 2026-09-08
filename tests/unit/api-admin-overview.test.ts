import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// A rota depende de requireAdmin (@/server/auth-guard), do DB (@/server/db) e de
// getEffectivePricing (@/server/plans-config); tudo é mockado com mock.module
// (requer --experimental-test-module-mocks). Sem a flag o arquivo inteiro é pulado.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP =
  "requer node --experimental-test-module-mocks para mockar @/server/auth-guard, @/server/db e @/server/plans-config";

// ─── Fakes ───

type AdminUser = { id: string; email: string | null };

let requireAdminImpl: () => Promise<AdminUser> = async () => ({ id: "admin-1", email: "admin@x.com" });

// Resultados das 4 consultas do Promise.all, consumidos na ordem em que o array
// literal é avaliado: totalUsers, proActive, newUsers7d, downloadsToday.
let selectResults: unknown[][] = [];
let selectCalls = 0;
let dbError: Error | null = null;

function thenableRows(rows: unknown[]) {
  // A primeira consulta é awaited logo após .from(); as demais chamam .where().
  // Por isso o resultado precisa ser uma Promise com .where() acoplado.
  const p = Promise.resolve(rows) as Promise<unknown[]> & { where: () => Promise<unknown[]> };
  p.where = () => Promise.resolve(rows);
  return p;
}

const fakeDb = {
  select() {
    if (dbError) throw dbError;
    selectCalls += 1;
    const rows = selectResults.shift() ?? [];
    return { from: () => thenableRows(rows) };
  },
};

let pricingImpl: () => Promise<{ amountCents: number; label: string }> = async () => ({
  amountCents: 1990,
  label: "R$ 19,90/mês",
});

if (canMockModules) {
  mock.module("@/server/auth-guard", { namedExports: { requireAdmin: () => requireAdminImpl() } });
  mock.module("@/server/db", { namedExports: { getDb: () => fakeDb } });
  mock.module("@/server/plans-config", {
    namedExports: { getEffectivePricing: () => pricingImpl() },
  });
}

async function importRoute() {
  return import("../../src/app/api/admin/overview/route.ts");
}

function asAdmin() {
  requireAdminImpl = async () => ({ id: "admin-1", email: "admin@x.com" });
}

function asUnauthenticated() {
  requireAdminImpl = async () => {
    throw new AppError("Faça login para continuar.", "UNAUTHORIZED", 401);
  };
}

function asNonAdmin() {
  requireAdminImpl = async () => {
    throw new AppError("Acesso restrito a administradores.", "FORBIDDEN", 403);
  };
}

function resetState() {
  asAdmin();
  selectResults = [];
  selectCalls = 0;
  dbError = null;
  pricingImpl = async () => ({ amountCents: 1990, label: "R$ 19,90/mês" });
}

async function bodyOf(res: Response) {
  return res.json();
}

// ─── Autenticação e autorização ───

test("GET: não autenticado retorna 401 UNAUTHORIZED", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asUnauthenticated();
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 401);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("GET: autenticado mas não admin retorna 403 FORBIDDEN", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asNonAdmin();
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 403);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "FORBIDDEN");
});

test("GET: sem autorização nem chega a consultar o DB", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asNonAdmin();
  const { GET } = await importRoute();
  await GET();
  assert.equal(selectCalls, 0);
});

// ─── Caminho feliz ───

test("GET: admin recebe métricas agregadas com receita estimada", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[{ c: 120 }], [{ c: 7 }], [{ c: 15 }], [{ total: 42 }]];
  pricingImpl = async () => ({ amountCents: 1990, label: "R$ 19,90/mês" });
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await bodyOf(res), {
    totalUsers: 120,
    proActive: 7,
    newUsers7d: 15,
    downloadsToday: 42,
    estRevenueCents: 7 * 1990,
    priceLabel: "R$ 19,90/mês",
  });
  assert.equal(selectCalls, 4, "deve executar as 4 consultas agregadas");
});

test("GET: downloadsToday converte string do SQL para número", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  // SUM() do Postgres chega como string no driver — a rota aplica Number().
  selectResults = [[{ c: 1 }], [{ c: 0 }], [{ c: 0 }], [{ total: "57" }]];
  const { GET } = await importRoute();
  const res = await GET();
  const body = await bodyOf(res);
  assert.equal(body.downloadsToday, 57);
  assert.equal(typeof body.downloadsToday, "number");
});

test("GET: consultas vazias caem nos fallbacks zero", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[], [], [], []];
  pricingImpl = async () => ({ amountCents: 1990, label: "R$ 19,90/mês" });
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await bodyOf(res), {
    totalUsers: 0,
    proActive: 0,
    newUsers7d: 0,
    downloadsToday: 0,
    estRevenueCents: 0,
    priceLabel: "R$ 19,90/mês",
  });
});

test("GET: receita estimada acompanha o preço efetivo retornado", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[{ c: 10 }], [{ c: 3 }], [{ c: 2 }], [{ total: 0 }]];
  pricingImpl = async () => ({ amountCents: 4990, label: "R$ 49,90/mês" });
  const { GET } = await importRoute();
  const res = await GET();
  const body = await bodyOf(res);
  assert.equal(body.estRevenueCents, 3 * 4990);
  assert.equal(body.priceLabel, "R$ 49,90/mês");
});

// ─── Erros ───

test("GET: erro do banco vira 500 INTERNAL_ERROR sem vazar detalhes", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  dbError = new Error("connection refused: senha-do-banco");
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(body).includes("senha-do-banco"));
});

test("GET: erro em getEffectivePricing vira 500", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[{ c: 1 }], [{ c: 1 }], [{ c: 1 }], [{ total: 1 }]];
  pricingImpl = async () => {
    throw new Error("plan_config indisponível");
  };
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});
