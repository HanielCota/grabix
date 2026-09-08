import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// A rota depende de requireAdmin (@/server/auth-guard), do DB (@/server/db), de
// loadConfig/invalidatePlansCache (@/server/plans-config) e de revalidatePath
// (next/cache); tudo é mockado com mock.module
// (requer --experimental-test-module-mocks). Sem a flag o arquivo inteiro é pulado.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP =
  "requer node --experimental-test-module-mocks para mockar @/server/auth-guard, @/server/db, @/server/plans-config e next/cache";

// ─── Fakes ───

type AdminUser = { id: string; email: string | null };

let requireAdminImpl: () => Promise<AdminUser> = async () => ({ id: "admin-1", email: "admin@x.com" });

function makePlan(downloadsPerDay: number) {
  return {
    id: "free",
    limits: { maxAssets: 10, maxFileSizeBytes: 500, maxZipSizeBytes: 1000, maxConcurrentDownloads: 2 },
    features: { deepCrawl: false, jsRendering: false, protectedVideo: false },
    quota: { downloadsPerDay },
  };
}

type LoadedConfig = {
  plans: { free: ReturnType<typeof makePlan>; pro: ReturnType<typeof makePlan> };
  pricing: { amountCents: number; label: string };
};

const defaultConfig: LoadedConfig = {
  plans: {
    free: makePlan(20),
    pro: { ...makePlan(Number.POSITIVE_INFINITY), id: "pro" },
  },
  pricing: { amountCents: 1990, label: "R$ 19,90/mês" },
};

let loadConfigImpl: (force?: boolean) => Promise<LoadedConfig> = async () => defaultConfig;
const loadConfigArgs: Array<boolean | undefined> = [];
let invalidateCalls = 0;
const revalidatedPaths: string[] = [];

let insertedValues: Record<string, unknown> | null = null;
let conflictSet: Record<string, unknown> | null = null;
let insertError: Error | null = null;

const fakeDb = {
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      insertedValues = v;
      return {
        onConflictDoUpdate: (opts: { set: Record<string, unknown> }) => {
          conflictSet = opts.set;
          return insertError ? Promise.reject(insertError) : Promise.resolve();
        },
      };
    },
  }),
};

if (canMockModules) {
  mock.module("@/server/auth-guard", { namedExports: { requireAdmin: () => requireAdminImpl() } });
  mock.module("@/server/db", { namedExports: { getDb: () => fakeDb } });
  mock.module("@/server/plans-config", {
    namedExports: {
      loadConfig: (force?: boolean) => {
        loadConfigArgs.push(force);
        return loadConfigImpl(force);
      },
      invalidatePlansCache: () => {
        invalidateCalls += 1;
      },
    },
  });
  mock.module("next/cache", {
    namedExports: {
      revalidatePath: (path: string) => {
        revalidatedPaths.push(path);
      },
    },
  });
}

async function importRoute() {
  return import("../../src/app/api/admin/plans/route.ts");
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
  loadConfigImpl = async () => defaultConfig;
  loadConfigArgs.length = 0;
  invalidateCalls = 0;
  revalidatedPaths.length = 0;
  insertedValues = null;
  conflictSet = null;
  insertError = null;
}

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/plans", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  id: "pro",
  maxAssets: 100,
  maxFileSizeBytes: 1024,
  maxZipSizeBytes: 2048,
  maxConcurrentDownloads: 5,
  deepCrawl: true,
  jsRendering: true,
  protectedVideo: false,
  downloadsPerDay: -1,
  priceAmountCents: 2490,
  priceLabel: "R$ 24,90",
};

async function bodyOf(res: Response) {
  return res.json();
}

// ─── GET ───

test("GET: não autenticado retorna 401", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asUnauthenticated();
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 401);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("GET: autenticado mas não admin retorna 403", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asNonAdmin();
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 403);
  assert.equal(loadConfigArgs.length, 0, "não deve carregar a config sem autorização");
});

test("GET: serializa planos forçando reload e converte downloads infinitos para -1", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(loadConfigArgs, [true], "deve forçar reload do cache (force=true)");
  const body = await bodyOf(res);
  assert.deepEqual(body.free, {
    maxAssets: 10,
    maxFileSizeBytes: 500,
    maxZipSizeBytes: 1000,
    maxConcurrentDownloads: 2,
    deepCrawl: false,
    jsRendering: false,
    protectedVideo: false,
    downloadsPerDay: 20,
  });
  assert.equal(body.pro.downloadsPerDay, -1, "Infinity deve serializar como -1");
  assert.deepEqual(body.pricing, { amountCents: 1990, label: "R$ 19,90/mês" });
});

test("GET: erro em loadConfig vira 500", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  loadConfigImpl = async () => {
    throw new Error("db down");
  };
  const { GET } = await importRoute();
  const res = await GET();
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

// ─── PUT: autenticação e validação ───

test("PUT: não autenticado retorna 401", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asUnauthenticated();
  const { PUT } = await importRoute();
  const res = await PUT(putRequest(validBody));
  assert.equal(res.status, 401);
  assert.equal(insertedValues, null, "não deve gravar sem autorização");
});

test("PUT: autenticado mas não admin retorna 403", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  asNonAdmin();
  const { PUT } = await importRoute();
  const res = await PUT(putRequest(validBody));
  assert.equal(res.status, 403);
  assert.equal(insertedValues, null);
});

test("PUT: maxAssets fora do intervalo vira 400 VALIDATION_ERROR", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { PUT } = await importRoute();
  for (const maxAssets of [0, 1001, 1.5]) {
    const res = await PUT(putRequest({ ...validBody, maxAssets }));
    assert.equal(res.status, 400, `maxAssets=${maxAssets}`);
    const body = await bodyOf(res);
    assert.equal(body.error.code, "VALIDATION_ERROR");
  }
  assert.equal(insertedValues, null);
});

test("PUT: id fora de free/pro vira 400 VALIDATION_ERROR", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { PUT } = await importRoute();
  const res = await PUT(putRequest({ ...validBody, id: "enterprise" }));
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("PUT: downloadsPerDay menor que -1 vira 400", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { PUT } = await importRoute();
  const res = await PUT(putRequest({ ...validBody, downloadsPerDay: -2 }));
  assert.equal(res.status, 400);
});

test("PUT: corpo que não é JSON vira 400 INVALID_JSON", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { PUT } = await importRoute();
  const req = new Request("http://localhost/api/admin/plans", { method: "PUT", body: "{quebrado" });
  const res = await PUT(req);
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INVALID_JSON");
});

// ─── PUT: caminho feliz ───

test("PUT: grava com upsert, invalida cache e revalida as páginas públicas", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const { PUT } = await importRoute();
  const res = await PUT(putRequest(validBody));
  assert.equal(res.status, 200);
  assert.deepEqual(await bodyOf(res), { ok: true });

  assert.deepEqual(insertedValues, { ...validBody });
  assert.ok(conflictSet, "onConflictDoUpdate deve receber o set");
  assert.equal(conflictSet?.id, "pro");
  assert.equal(conflictSet?.priceAmountCents, 2490);
  assert.ok(conflictSet?.updatedAt instanceof Date, "set deve atualizar updatedAt");

  assert.equal(invalidateCalls, 1, "deve invalidar o cache em memória");
  assert.deepEqual(revalidatedPaths, ["/", "/pricing", "/admin", "/admin/plans"]);
});

test("PUT: campos de preço opcionais ausentes são gravados como null", {
  skip: !canMockModules && SKIP,
}, async () => {
  resetState();
  const { PUT } = await importRoute();
  const { priceAmountCents: _, priceLabel: __, ...semPreco } = validBody;
  const res = await PUT(putRequest(semPreco));
  assert.equal(res.status, 200);
  assert.equal(insertedValues?.priceAmountCents, null);
  assert.equal(insertedValues?.priceLabel, null);
});

test("PUT: downloadsPerDay -1 (ilimitado) é aceito", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  const { PUT } = await importRoute();
  const res = await PUT(putRequest({ ...validBody, downloadsPerDay: -1 }));
  assert.equal(res.status, 200);
  assert.equal(insertedValues?.downloadsPerDay, -1);
});

test("PUT: erro do banco vira 500 e não revalida páginas", { skip: !canMockModules && SKIP }, async () => {
  resetState();
  insertError = new Error("db down");
  const { PUT } = await importRoute();
  const res = await PUT(putRequest(validBody));
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(invalidateCalls, 0, "cache não deve ser invalidado após falha no insert");
  assert.deepEqual(revalidatedPaths, []);
});
