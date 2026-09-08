import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// A rota depende de requireAdmin (@/server/auth-guard) e das funções de
// @/server/url-failures; ambos são mockados com mock.module
// (requer --experimental-test-module-mocks). Sem a flag o arquivo inteiro é pulado.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = "requer node --experimental-test-module-mocks para mockar @/server/auth-guard e @/server/url-failures";

// ─── Fakes ───

type AdminUser = { id: string; email: string | null };

let requireAdminImpl: () => Promise<AdminUser> = async () => ({ id: "admin-1", email: "admin@x.com" });

type ListOpts = { q?: string; includeResolved?: boolean };

let listImpl: (opts: ListOpts) => Promise<unknown[]> = async () => [];
const listCalls: ListOpts[] = [];
const resolvedCalls: Array<{ id: string; resolved: boolean }> = [];
const deletedIds: string[] = [];
let mutationError: Error | null = null;

if (canMockModules) {
  mock.module("@/server/auth-guard", { namedExports: { requireAdmin: () => requireAdminImpl() } });
  mock.module("@/server/url-failures", {
    namedExports: {
      listUrlFailures: (opts: ListOpts) => {
        listCalls.push(opts);
        return listImpl(opts);
      },
      setUrlFailureResolved: (id: string, resolved: boolean) => {
        resolvedCalls.push({ id, resolved });
        return mutationError ? Promise.reject(mutationError) : Promise.resolve();
      },
      deleteUrlFailure: (id: string) => {
        deletedIds.push(id);
        return mutationError ? Promise.reject(mutationError) : Promise.resolve();
      },
    },
  });
}

async function importRoute() {
  return import("../../src/app/api/admin/failed-urls/route.ts");
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
  listImpl = async () => [];
  listCalls.length = 0;
  resolvedCalls.length = 0;
  deletedIds.length = 0;
  mutationError = null;
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function postRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/admin/failed-urls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function bodyOf(res: Response) {
  return res.json();
}

// ─── GET: autenticação e autorização ───

test("GET: não autenticado retorna 401", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asUnauthenticated();
  const { GET } = await importRoute();
  const res = await GET(getRequest("http://localhost/api/admin/failed-urls"));
  assert.equal(res.status, 401);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("GET: autenticado mas não admin retorna 403", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asNonAdmin();
  const { GET } = await importRoute();
  const res = await GET(getRequest("http://localhost/api/admin/failed-urls"));
  assert.equal(res.status, 403);
  assert.equal(listCalls.length, 0, "não deve consultar o repositório sem autorização");
});

// ─── GET: listagem ───

test("GET: sem parâmetros lista apenas não resolvidos e sem filtro de texto", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const items = [{ id: "f-1", url: "https://x.com/v", reason: "NO_MEDIA" }];
  listImpl = async () => items;
  const { GET } = await importRoute();
  const res = await GET(getRequest("http://localhost/api/admin/failed-urls"));
  assert.equal(res.status, 200);
  assert.deepEqual(await bodyOf(res), { items });
  assert.deepEqual(listCalls, [{ q: undefined, includeResolved: false }]);
});

test("GET: repassa q trimmed e includeResolved=1 para o repositório", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { GET } = await importRoute();
  const res = await GET(getRequest("http://localhost/api/admin/failed-urls?q=%20vturb%20&includeResolved=1"));
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls, [{ q: "vturb", includeResolved: true }]);
});

test("GET: q só com espaços vira undefined", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { GET } = await importRoute();
  await GET(getRequest("http://localhost/api/admin/failed-urls?q=%20%20%20"));
  assert.deepEqual(listCalls, [{ q: undefined, includeResolved: false }]);
});

test("GET: includeResolved com valor diferente de '1' é tratado como false", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const { GET } = await importRoute();
  await GET(getRequest("http://localhost/api/admin/failed-urls?includeResolved=true"));
  assert.deepEqual(listCalls, [{ q: undefined, includeResolved: false }]);
});

test("GET: erro do repositório vira 500", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  listImpl = async () => {
    throw new Error("db down");
  };
  const { GET } = await importRoute();
  const res = await GET(getRequest("http://localhost/api/admin/failed-urls"));
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

// ─── POST: autenticação e validação ───

test("POST: não autenticado retorna 401 sem ler o corpo", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asUnauthenticated();
  const { POST } = await importRoute();
  const res = await POST(postRequest({ id: "f-1", action: "resolve" }));
  assert.equal(res.status, 401);
  assert.equal(resolvedCalls.length, 0);
});

test("POST: autenticado mas não admin retorna 403", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asNonAdmin();
  const { POST } = await importRoute();
  const res = await POST(postRequest({ id: "f-1", action: "resolve" }));
  assert.equal(res.status, 403);
});

test("POST: action desconhecida vira 400 VALIDATION_ERROR", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { POST } = await importRoute();
  const res = await POST(postRequest({ id: "f-1", action: "purge" }));
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("POST: id vazio vira 400 VALIDATION_ERROR", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { POST } = await importRoute();
  const res = await POST(postRequest({ id: "", action: "resolve" }));
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("POST: corpo que não é JSON vira 400 INVALID_JSON", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { POST } = await importRoute();
  const req = new Request("http://localhost/api/admin/failed-urls", {
    method: "POST",
    body: "{quebrado",
  }) as unknown as NextRequest;
  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INVALID_JSON");
});

// ─── POST: ações ───

test("POST: action resolve marca como resolvido", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { POST } = await importRoute();
  const res = await POST(postRequest({ id: "f-9", action: "resolve" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await bodyOf(res), { ok: true });
  assert.deepEqual(resolvedCalls, [{ id: "f-9", resolved: true }]);
  assert.deepEqual(deletedIds, []);
});

test("POST: action reopen desmarca resolvido", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { POST } = await importRoute();
  const res = await POST(postRequest({ id: "f-9", action: "reopen" }));
  assert.equal(res.status, 200);
  assert.deepEqual(resolvedCalls, [{ id: "f-9", resolved: false }]);
});

test("POST: action delete remove o registro sem chamar setUrlFailureResolved", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const { POST } = await importRoute();
  const res = await POST(postRequest({ id: "f-9", action: "delete" }));
  assert.equal(res.status, 200);
  assert.deepEqual(deletedIds, ["f-9"]);
  assert.deepEqual(resolvedCalls, []);
});

test("POST: erro do repositório na mutação vira 500", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  mutationError = new Error("db down");
  const { POST } = await importRoute();
  const res = await POST(postRequest({ id: "f-9", action: "delete" }));
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});
