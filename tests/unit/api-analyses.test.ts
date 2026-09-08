import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// Testa as rotas GET /api/analyses e GET/PATCH/DELETE /api/analyses/[id]
// (src/app/api/analyses/route.ts e src/app/api/analyses/[id]/route.ts) com
// requireUser e analysis-history mockados; handleApiError e zod são reais.
// Requer --experimental-test-module-mocks.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const needsMock = { skip: !canMockModules && "requer node --experimental-test-module-mocks" };

type User = { id: string; email?: string | null };

let userImpl: User | null = { id: "u-1", email: "ana@x.com" };
let authError: Error | null = null;

let listImpl: unknown = [];
let getImpl: unknown = null;
let updateImpl: unknown = null;
let deleteImpl = false;
let depError: Error | null = null;
const listCalls: Array<{ userId: string; query?: string }> = [];
const idCalls: Array<{ fn: string; userId: string; id: string; selectedUrls?: string[] }> = [];

function guard<T>(value: T): Promise<T> {
  if (depError) return Promise.reject(depError);
  return Promise.resolve(value);
}

if (canMockModules) {
  mock.module("@/server/auth-guard", {
    namedExports: {
      requireUser: () => {
        if (authError) return Promise.reject(authError);
        return Promise.resolve(userImpl);
      },
    },
  });
  mock.module("@/server/analysis-history", {
    namedExports: {
      listSavedAnalyses: (userId: string, query?: string) => {
        listCalls.push({ userId, query });
        return guard(listImpl);
      },
      getSavedAnalysis: (userId: string, id: string) => {
        idCalls.push({ fn: "get", userId, id });
        return guard(getImpl);
      },
      updateSavedAnalysisSelection: (userId: string, id: string, selectedUrls: string[]) => {
        idCalls.push({ fn: "update", userId, id, selectedUrls });
        return guard(updateImpl);
      },
      deleteSavedAnalysis: (userId: string, id: string) => {
        idCalls.push({ fn: "delete", userId, id });
        return guard(deleteImpl);
      },
    },
  });
}

async function importListRoute() {
  return import("../../src/app/api/analyses/route.ts");
}

async function importIdRoute() {
  return import("../../src/app/api/analyses/[id]/route.ts");
}

function reset() {
  userImpl = { id: "u-1", email: "ana@x.com" };
  authError = null;
  listImpl = [];
  getImpl = null;
  updateImpl = null;
  deleteImpl = false;
  depError = null;
  listCalls.length = 0;
  idCalls.length = 0;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ANALYSIS = { id: "a-1", pageUrl: "https://x.com/post", assets: [] };

// ─── GET /api/analyses ───

test("GET /api/analyses: lista do usuário sem filtro passa query undefined", needsMock, async () => {
  const { GET } = await importListRoute();
  reset();
  listImpl = [ANALYSIS];
  const res = await GET(new Request("https://grabix.app/api/analyses"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { analyses: [ANALYSIS] });
  assert.deepEqual(listCalls, [{ userId: "u-1", query: undefined }]);
});

test("GET /api/analyses: repassa ?q= como filtro de busca", needsMock, async () => {
  const { GET } = await importListRoute();
  reset();
  await GET(new Request("https://grabix.app/api/analyses?q=twitter"));
  assert.deepEqual(listCalls, [{ userId: "u-1", query: "twitter" }]);
});

test("GET /api/analyses: sem sessão retorna 401 e não lista", needsMock, async () => {
  const { GET } = await importListRoute();
  reset();
  authError = new AppError("Faça login para continuar.", "UNAUTHORIZED", 401);
  const res = await GET(new Request("https://grabix.app/api/analyses"));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "UNAUTHORIZED");
  assert.equal(listCalls.length, 0);
});

test("GET /api/analyses: erro da camada de dados vira 500", needsMock, async () => {
  const { GET } = await importListRoute();
  reset();
  depError = new Error("db down");
  const res = await GET(new Request("https://grabix.app/api/analyses"));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error.code, "INTERNAL_ERROR");
});

// ─── GET /api/analyses/[id] ───

test("GET /api/analyses/[id]: retorna a análise encontrada", needsMock, async () => {
  const { GET } = await importIdRoute();
  reset();
  getImpl = ANALYSIS;
  const res = await GET(new Request("https://grabix.app/api/analyses/a-1"), params("a-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), ANALYSIS);
  assert.deepEqual(idCalls, [{ fn: "get", userId: "u-1", id: "a-1" }]);
});

test("GET /api/analyses/[id]: análise inexistente retorna 404", needsMock, async () => {
  const { GET } = await importIdRoute();
  reset();
  getImpl = null;
  const res = await GET(new Request("https://grabix.app/api/analyses/a-9"), params("a-9"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.message, "Análise não encontrada.");
});

test("GET /api/analyses/[id]: sem sessão retorna 401", needsMock, async () => {
  const { GET } = await importIdRoute();
  reset();
  authError = new AppError("Faça login para continuar.", "UNAUTHORIZED", 401);
  const res = await GET(new Request("https://grabix.app/api/analyses/a-1"), params("a-1"));
  assert.equal(res.status, 401);
  assert.equal(idCalls.length, 0);
});

// ─── PATCH /api/analyses/[id] ───

test("PATCH /api/analyses/[id]: atualiza a seleção de URLs", needsMock, async () => {
  const { PATCH } = await importIdRoute();
  reset();
  const urls = ["https://cdn.x.com/1.jpg", "https://cdn.x.com/2.jpg"];
  updateImpl = urls;
  const req = new Request("https://grabix.app/api/analyses/a-1", {
    method: "PATCH",
    body: JSON.stringify({ selectedUrls: urls }),
  });
  const res = await PATCH(req, params("a-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { selectedUrls: urls });
  assert.deepEqual(idCalls, [{ fn: "update", userId: "u-1", id: "a-1", selectedUrls: urls }]);
});

test("PATCH /api/analyses/[id]: análise inexistente retorna 404", needsMock, async () => {
  const { PATCH } = await importIdRoute();
  reset();
  updateImpl = null;
  const req = new Request("https://grabix.app/api/analyses/a-9", {
    method: "PATCH",
    body: JSON.stringify({ selectedUrls: [] }),
  });
  const res = await PATCH(req, params("a-9"));
  assert.equal(res.status, 404);
});

test("PATCH /api/analyses/[id]: selectedUrls com URL inválida retorna 400 VALIDATION_ERROR", needsMock, async () => {
  const { PATCH } = await importIdRoute();
  reset();
  const req = new Request("https://grabix.app/api/analyses/a-1", {
    method: "PATCH",
    body: JSON.stringify({ selectedUrls: ["não-é-url"] }),
  });
  const res = await PATCH(req, params("a-1"));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(body.error.details)); // issues do zod
  assert.equal(idCalls.length, 0); // não chega na camada de dados
});

test("PATCH /api/analyses/[id]: mais de 200 URLs retorna 400", needsMock, async () => {
  const { PATCH } = await importIdRoute();
  reset();
  const urls = Array.from({ length: 201 }, (_, i) => `https://cdn.x.com/${i}.jpg`);
  const req = new Request("https://grabix.app/api/analyses/a-1", {
    method: "PATCH",
    body: JSON.stringify({ selectedUrls: urls }),
  });
  const res = await PATCH(req, params("a-1"));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "VALIDATION_ERROR");
});

test("PATCH /api/analyses/[id]: corpo sem selectedUrls retorna 400", needsMock, async () => {
  const { PATCH } = await importIdRoute();
  reset();
  const req = new Request("https://grabix.app/api/analyses/a-1", {
    method: "PATCH",
    body: JSON.stringify({ foo: "bar" }),
  });
  const res = await PATCH(req, params("a-1"));
  assert.equal(res.status, 400);
});

test("PATCH /api/analyses/[id]: corpo não-JSON retorna 400 INVALID_JSON", needsMock, async () => {
  const { PATCH } = await importIdRoute();
  reset();
  const req = new Request("https://grabix.app/api/analyses/a-1", { method: "PATCH", body: "{quebrado" });
  const res = await PATCH(req, params("a-1"));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "INVALID_JSON");
});

// ─── DELETE /api/analyses/[id] ───

test("DELETE /api/analyses/[id]: remoção retorna 204 sem corpo", needsMock, async () => {
  const { DELETE } = await importIdRoute();
  reset();
  deleteImpl = true;
  const res = await DELETE(new Request("https://grabix.app/api/analyses/a-1"), params("a-1"));
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
  assert.deepEqual(idCalls, [{ fn: "delete", userId: "u-1", id: "a-1" }]);
});

test("DELETE /api/analyses/[id]: análise inexistente retorna 404", needsMock, async () => {
  const { DELETE } = await importIdRoute();
  reset();
  deleteImpl = false;
  const res = await DELETE(new Request("https://grabix.app/api/analyses/a-9"), params("a-9"));
  assert.equal(res.status, 404);
});

test("DELETE /api/analyses/[id]: sem sessão retorna 401 e não deleta", needsMock, async () => {
  const { DELETE } = await importIdRoute();
  reset();
  authError = new AppError("Faça login para continuar.", "UNAUTHORIZED", 401);
  const res = await DELETE(new Request("https://grabix.app/api/analyses/a-1"), params("a-1"));
  assert.equal(res.status, 401);
  assert.equal(idCalls.length, 0);
});
