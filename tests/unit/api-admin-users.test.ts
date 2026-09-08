import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// As rotas dependem de requireAdmin (@/server/auth-guard), do DB (@/server/db) e
// de upsertSubscription (@/server/entitlements); tudo é mockado com mock.module
// (requer --experimental-test-module-mocks). Sem a flag o arquivo inteiro é pulado.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP =
  "requer node --experimental-test-module-mocks para mockar @/server/auth-guard, @/server/db e @/server/entitlements";

// ─── Fakes ───

type AdminUser = { id: string; email: string | null };

let requireAdminImpl: () => Promise<AdminUser> = async () => ({ id: "admin-1", email: "admin@x.com" });

let selectResults: unknown[][] = [];
let selectCalls = 0;
let whereArg: unknown;
let dbError: Error | null = null;
let updateSet: Record<string, unknown> | null = null;
let auditValues: Record<string, unknown> | null = null;

// Cadeia auto-similar: cobre tanto o GET (select.from.leftJoin.leftJoin.where
// .orderBy.limit) quanto o POST de [id] (select.from.where.limit).
interface QueryChain {
  leftJoin: () => QueryChain;
  where: (cond: unknown) => QueryChain;
  orderBy: () => QueryChain;
  limit: (n: number) => Promise<unknown[]>;
}

function makeChain(rows: unknown[]): QueryChain {
  const node: QueryChain = {
    leftJoin: () => node,
    where: (cond: unknown) => {
      whereArg = cond;
      return node;
    },
    orderBy: () => node,
    limit: () => Promise.resolve(rows),
  };
  return node;
}

const fakeDb = {
  select() {
    if (dbError) throw dbError;
    selectCalls += 1;
    return { from: () => makeChain(selectResults.shift() ?? []) };
  },
  update() {
    return {
      set: (v: Record<string, unknown>) => {
        updateSet = v;
        return { where: () => (dbError ? Promise.reject(dbError) : Promise.resolve()) };
      },
    };
  },
  insert() {
    return {
      values: (v: Record<string, unknown>) => {
        auditValues = v;
        return dbError ? Promise.reject(dbError) : Promise.resolve();
      },
    };
  },
};

type UpsertData = { plan: string; status: string; provider: string; currentPeriodEnd: Date | null };

const upsertCalls: Array<{ userId: string; data: UpsertData }> = [];
let upsertError: Error | null = null;

if (canMockModules) {
  mock.module("@/server/auth-guard", { namedExports: { requireAdmin: () => requireAdminImpl() } });
  mock.module("@/server/db", { namedExports: { getDb: () => fakeDb } });
  mock.module("@/server/entitlements", {
    namedExports: {
      upsertSubscription: (userId: string, data: UpsertData) => {
        upsertCalls.push({ userId, data });
        return upsertError ? Promise.reject(upsertError) : Promise.resolve();
      },
    },
  });
}

async function importListRoute() {
  return import("../../src/app/api/admin/users/route.ts");
}

async function importDetailRoute() {
  return import("../../src/app/api/admin/users/[id]/route.ts");
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
  whereArg = undefined;
  dbError = null;
  updateSet = null;
  auditValues = null;
  upsertCalls.length = 0;
  upsertError = null;
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function postRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/admin/users/u-1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function paramsOf(id: string) {
  return { params: Promise.resolve({ id }) };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "u-1",
    name: "Ana",
    email: "ana@x.com",
    image: null,
    isAdmin: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    subPlan: null,
    subStatus: null,
    currentPeriodEnd: null,
    usageToday: null,
    ...overrides,
  };
}

async function bodyOf(res: Response) {
  return res.json();
}

// ─── GET /api/admin/users: autenticação e autorização ───

test("GET: não autenticado retorna 401", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asUnauthenticated();
  const { GET } = await importListRoute();
  const res = await GET(getRequest("http://localhost/api/admin/users"));
  assert.equal(res.status, 401);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("GET: autenticado mas não admin retorna 403 sem consultar o DB", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  asNonAdmin();
  const { GET } = await importListRoute();
  const res = await GET(getRequest("http://localhost/api/admin/users"));
  assert.equal(res.status, 403);
  assert.equal(selectCalls, 0);
});

// ─── GET /api/admin/users: listagem e mapeamento ───

test("GET: mapeia linhas do DB para o formato da lista", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const futuro = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  selectResults = [[userRow({ subPlan: "pro", subStatus: "active", currentPeriodEnd: futuro, usageToday: 5 })]];
  const { GET } = await importListRoute();
  const res = await GET(getRequest("http://localhost/api/admin/users"));
  assert.equal(res.status, 200);
  const body = await bodyOf(res);
  assert.equal(body.users.length, 1);
  const item = body.users[0];
  assert.equal(item.id, "u-1");
  assert.equal(item.email, "ana@x.com");
  assert.equal(item.plan, "pro", "assinatura ativa e vigente deve mapear para pro");
  assert.equal(item.subStatus, "active");
  assert.equal(item.usageToday, 5);
  assert.equal(item.subPlan, undefined, "subPlan não deve vazar para a resposta");
});

test("GET: deriva plano free/pro a partir de subStatus + currentPeriodEnd", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const futuro = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const passado = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  selectResults = [
    [
      userRow({ id: "u-active-null", subStatus: "active", currentPeriodEnd: null }),
      userRow({ id: "u-active-futuro", subStatus: "active", currentPeriodEnd: futuro }),
      userRow({ id: "u-active-passado", subStatus: "active", currentPeriodEnd: passado }),
      userRow({ id: "u-cancel-futuro", subStatus: "canceled", currentPeriodEnd: futuro }),
      userRow({ id: "u-cancel-passado", subStatus: "canceled", currentPeriodEnd: passado }),
      userRow({ id: "u-past-due", subStatus: "past_due", currentPeriodEnd: futuro }),
      userRow({ id: "u-sem-sub" }),
    ],
  ];
  const { GET } = await importListRoute();
  const res = await GET(getRequest("http://localhost/api/admin/users"));
  const body = await bodyOf(res);
  const plans = Object.fromEntries(body.users.map((u: { id: string; plan: string }) => [u.id, u.plan]));
  assert.deepEqual(plans, {
    "u-active-null": "pro",
    "u-active-futuro": "pro",
    "u-active-passado": "free",
    "u-cancel-futuro": "pro",
    "u-cancel-passado": "free",
    "u-past-due": "free",
    "u-sem-sub": "free",
  });
});

test("GET: usageToday null vira 0", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[userRow({ usageToday: null })]];
  const { GET } = await importListRoute();
  const res = await GET(getRequest("http://localhost/api/admin/users"));
  const body = await bodyOf(res);
  assert.equal(body.users[0].usageToday, 0);
});

test("GET: com q aplica filtro de busca; sem q passa undefined para o where", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  selectResults = [[]];
  const { GET } = await importListRoute();
  await GET(getRequest("http://localhost/api/admin/users?q=%20ana%20"));
  assert.ok(whereArg !== undefined, "com q o where deve receber uma condição");

  resetState();
  selectResults = [[]];
  await GET(getRequest("http://localhost/api/admin/users"));
  assert.equal(whereArg, undefined, "sem q o where deve receber undefined");
});

test("GET: erro do banco vira 500", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  dbError = new Error("db down");
  const { GET } = await importListRoute();
  const res = await GET(getRequest("http://localhost/api/admin/users"));
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

// ─── POST /api/admin/users/[id]: autenticação e validação ───

test("POST [id]: não autenticado retorna 401", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asUnauthenticated();
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "grantPro" }), paramsOf("u-1"));
  assert.equal(res.status, 401);
  assert.equal(upsertCalls.length, 0);
});

test("POST [id]: autenticado mas não admin retorna 403", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asNonAdmin();
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "grantPro" }), paramsOf("u-1"));
  assert.equal(res.status, 403);
  assert.equal(upsertCalls.length, 0);
});

test("POST [id]: action desconhecida vira 400 VALIDATION_ERROR", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "deleteUser" }), paramsOf("u-1"));
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

// ─── POST /api/admin/users/[id]: guardas e ações ───

test("POST [id]: admin não pode remover o próprio acesso de admin", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "setAdmin", value: false }), paramsOf("admin-1"));
  assert.equal(res.status, 403);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "FORBIDDEN");
  assert.equal(body.error.message, "Você não pode remover seu próprio acesso de admin.");
  assert.equal(selectCalls, 0, "a guarda deve barrar antes de consultar o DB");
});

test("POST [id]: setAdmin false em OUTRO usuário é permitido", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[{ id: "u-2" }]];
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "setAdmin", value: false }), paramsOf("u-2"));
  assert.equal(res.status, 200);
  assert.deepEqual(updateSet, { isAdmin: false });
});

test("POST [id]: usuário inexistente retorna 404 NOT_FOUND", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[]];
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "grantPro" }), paramsOf("u-inexistente"));
  assert.equal(res.status, 404);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(body.error.message, "Usuário não encontrado.");
  assert.equal(upsertCalls.length, 0, "não deve executar a ação sem o usuário existir");
});

test("POST [id]: grantPro cria assinatura pro ativa via admin e registra auditoria", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  selectResults = [[{ id: "u-1" }]];
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "grantPro" }), paramsOf("u-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(await bodyOf(res), { ok: true });
  assert.deepEqual(upsertCalls, [
    { userId: "u-1", data: { plan: "pro", status: "active", provider: "admin", currentPeriodEnd: null } },
  ]);
  assert.equal(auditValues?.actorId, "admin-1");
  assert.equal(auditValues?.targetUserId, "u-1");
  assert.equal(auditValues?.action, "grantPro");
  assert.equal(auditValues?.payload, "{}", "value ausente serializa como {}");
});

test("POST [id]: revokePro marca assinatura free inativa", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  selectResults = [[{ id: "u-1" }]];
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "revokePro" }), paramsOf("u-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(upsertCalls, [
    { userId: "u-1", data: { plan: "free", status: "inactive", provider: "admin", currentPeriodEnd: null } },
  ]);
  assert.equal(auditValues?.action, "revokePro");
});

test("POST [id]: setAdmin true atualiza o usuário e registra value no payload", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  selectResults = [[{ id: "u-1" }]];
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "setAdmin", value: true }), paramsOf("u-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(updateSet, { isAdmin: true });
  assert.equal(auditValues?.action, "setAdmin");
  assert.equal(auditValues?.payload, '{"value":true}');
});

test("POST [id]: erro do banco vira 500", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  dbError = new Error("db down");
  const { POST } = await importDetailRoute();
  const res = await POST(postRequest({ action: "grantPro" }), paramsOf("u-1"));
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});
