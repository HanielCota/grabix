import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// A rota depende de requireAdmin (@/server/auth-guard) e do DB (@/server/db);
// ambos são mockados com mock.module (requer --experimental-test-module-mocks).
// Sem a flag o arquivo inteiro é pulado.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = "requer node --experimental-test-module-mocks para mockar @/server/auth-guard e @/server/db";

// ─── Fakes ───

type AdminUser = { id: string; email: string | null };

let requireAdminImpl: () => Promise<AdminUser> = async () => ({ id: "admin-1", email: "admin@x.com" });

// Resultados das 2 consultas do Promise.all, na ordem: assinaturas, webhook events.
let selectResults: unknown[][] = [];
let selectCalls = 0;
const limitArgs: number[] = [];
let dbError: Error | null = null;

// Cadeia auto-similar: cobre select().from().leftJoin().orderBy().limit() da
// primeira consulta e select().from().orderBy().limit() da segunda.
interface QueryChain {
  leftJoin: () => QueryChain;
  orderBy: () => QueryChain;
  limit: (n: number) => Promise<unknown[]>;
}

function makeChain(rows: unknown[]): QueryChain {
  const node: QueryChain = {
    leftJoin: () => node,
    orderBy: () => node,
    limit: (n: number) => {
      limitArgs.push(n);
      return Promise.resolve(rows);
    },
  };
  return node;
}

const fakeDb = {
  select() {
    if (dbError) throw dbError;
    selectCalls += 1;
    return { from: () => makeChain(selectResults.shift() ?? []) };
  },
};

if (canMockModules) {
  mock.module("@/server/auth-guard", { namedExports: { requireAdmin: () => requireAdminImpl() } });
  mock.module("@/server/db", { namedExports: { getDb: () => fakeDb } });
}

async function importRoute() {
  return import("../../src/app/api/admin/subscriptions/route.ts");
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
  limitArgs.length = 0;
  dbError = null;
}

async function bodyOf(res: Response) {
  return res.json();
}

// ─── Autenticação e autorização ───

test("GET: não autenticado retorna 401", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asUnauthenticated();
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 401);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("GET: autenticado mas não admin retorna 403 sem consultar o DB", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  asNonAdmin();
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 403);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "FORBIDDEN");
  assert.equal(selectCalls, 0);
});

// ─── Caminho feliz ───

test("GET: retorna assinaturas (limite 200) e eventos de webhook (limite 50)", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const subs = [{ id: "sub-1", userId: "u-1", email: "ana@x.com", plan: "pro", status: "active" }];
  const events = [{ id: "evt-1", provider: "mercadopago", type: "payment" }];
  selectResults = [subs, events];
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await bodyOf(res), { subscriptions: subs, events });
  assert.equal(selectCalls, 2);
  assert.deepEqual(limitArgs, [200, 50], "assinaturas limitadas a 200 e eventos a 50");
});

test("GET: banco vazio retorna listas vazias", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[], []];
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await bodyOf(res), { subscriptions: [], events: [] });
});

test("GET: assinatura sem usuário associado (leftJoin) vem com email null", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const subs = [{ id: "sub-2", userId: "u-x", email: null, plan: "pro", status: "past_due" }];
  selectResults = [subs, []];
  const { GET } = await importRoute();
  const res = await GET();
  const body = await bodyOf(res);
  assert.equal(body.subscriptions[0].email, null);
});

// ─── Erros ───

test("GET: erro do banco vira 500 INTERNAL_ERROR", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  dbError = new Error("db down");
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});
