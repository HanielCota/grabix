import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { Errors } from "../../src/features/media-downloader/domain/errors.ts";
import type { MediaAsset } from "../../src/features/media-downloader/domain/types.ts";
import type { Plan } from "../../src/server/plans.ts";

// A rota /api/analyze depende de auth, rate limit, entitlements (DB), do
// extrator (rede), do histórico (DB) e da telemetria de falhas (DB). Tudo é
// mockado com mock.module usando o mesmo especificador que a rota importa
// (alias "@/..."), seguindo a convenção de tests/unit/auth-guard.test.ts.
// Sem --experimental-test-module-mocks o arquivo inteiro é pulado.
//
// handleApiError e os schemas zod NÃO são mockados: são puros e já cobertos
// por tests/unit/api-utils.test.ts.

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = "requer node --experimental-test-module-mocks para mockar as dependências da rota";

type AuthedUser = { id: string; email?: string | null; name?: string | null };
type RateResult = { limited: boolean; remaining: number; resetAt: number; limit: number };
type AnalyzeRaw = { url: string; totalFound: number; assets: MediaAsset[]; pagesScanned?: number };
type AnalyzeOpts = { allowJsRendering: boolean };

const freePlan: Plan = {
  id: "free",
  limits: {
    maxAssets: 10,
    maxFileSizeBytes: 50 * 1024 * 1024,
    maxZipSizeBytes: 100 * 1024 * 1024,
    maxConcurrentDownloads: 2,
  },
  features: { deepCrawl: false, jsRendering: false, protectedVideo: false },
  quota: { downloadsPerDay: 20 },
};

const proPlan: Plan = {
  id: "pro",
  limits: {
    maxAssets: 200,
    maxFileSizeBytes: 100 * 1024 * 1024,
    maxZipSizeBytes: 500 * 1024 * 1024,
    maxConcurrentDownloads: 8,
  },
  features: { deepCrawl: true, jsRendering: true, protectedVideo: true },
  quota: { downloadsPerDay: Number.POSITIVE_INFINITY },
};

let requireUserImpl: () => Promise<AuthedUser> = async () => ({ id: "u-1" });
let rateLimitImpl: (key: string, opts?: { max?: number; windowMs?: number }) => Promise<RateResult> = async () => ({
  limited: false,
  remaining: 19,
  resetAt: 0,
  limit: 20,
});
let planImpl: (userId: string) => Promise<Plan> = async () => freePlan;
let analyzeImpl: (
  url: string,
  deepCrawl: boolean,
  signal: AbortSignal | undefined,
  opts: AnalyzeOpts,
) => Promise<AnalyzeRaw> = async (url, _deepCrawl, _signal, _opts) => ({
  url,
  totalFound: 1,
  assets: [asset()],
});
let saveImpl: (userId: string, result: unknown, deepCrawl: boolean) => Promise<{ id: string }> = async () => ({
  id: "an-1",
});

const rateLimitCalls: Array<{ key: string; opts?: { max?: number; windowMs?: number } }> = [];
const analyzeCalls: Array<{ url: string; deepCrawl: boolean; opts: AnalyzeOpts }> = [];
const saveCalls: Array<{ userId: string; deepCrawl: boolean }> = [];
const failureCalls: Array<{
  url: string;
  reason: string;
  message?: string | null;
  deepCrawl?: boolean;
  userId?: string | null;
}> = [];

if (canMockModules) {
  mock.module("@/server/auth-guard", {
    namedExports: { requireUser: () => requireUserImpl() },
  });
  mock.module("@/server/rate-limit", {
    namedExports: {
      checkRateLimit: (key: string, opts?: { max?: number; windowMs?: number }) => {
        rateLimitCalls.push({ key, opts });
        return rateLimitImpl(key, opts);
      },
    },
  });
  mock.module("@/server/entitlements", {
    namedExports: { getUserPlan: (userId: string) => planImpl(userId) },
  });
  mock.module("@/features/media-downloader/application/analyze-page", {
    namedExports: {
      analyzePage: (url: string, deepCrawl: boolean, signal: AbortSignal | undefined, opts: AnalyzeOpts) => {
        analyzeCalls.push({ url, deepCrawl, opts });
        return analyzeImpl(url, deepCrawl, signal, opts);
      },
    },
  });
  mock.module("@/server/analysis-history", {
    namedExports: {
      saveCompletedAnalysis: (userId: string, result: unknown, deepCrawl: boolean) => {
        saveCalls.push({ userId, deepCrawl });
        return saveImpl(userId, result, deepCrawl);
      },
    },
  });
  mock.module("@/server/url-failures", {
    namedExports: {
      recordUrlFailure: (input: (typeof failureCalls)[number]) => {
        failureCalls.push(input);
        return Promise.resolve();
      },
    },
  });
}

async function importRoute() {
  return import("../../src/app/api/analyze/route.ts");
}

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    url: "https://cdn.example.com/a.mp4",
    type: "VIDEO",
    fileName: "a.mp4",
    extension: "mp4",
    sourceTag: "video",
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

function makeInvalidJsonRequest(): NextRequest {
  return {
    json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")),
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

function resetDefaults() {
  requireUserImpl = async () => ({ id: "u-1" });
  rateLimitImpl = async () => ({ limited: false, remaining: 19, resetAt: 0, limit: 20 });
  planImpl = async () => freePlan;
  analyzeImpl = async (url) => ({ url, totalFound: 1, assets: [asset()] });
  saveImpl = async () => ({ id: "an-1" });
  rateLimitCalls.length = 0;
  analyzeCalls.length = 0;
  saveCalls.length = 0;
  failureCalls.length = 0;
}

describe("POST /api/analyze", { skip: !canMockModules && SKIP }, () => {
  // ─── Autenticação e rate limit ───

  test("sem sessão retorna 401 UNAUTHORIZED", async () => {
    resetDefaults();
    requireUserImpl = async () => {
      throw Errors.unauthorized();
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com" }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
    assert.equal(analyzeCalls.length, 0);
    assert.equal(failureCalls.length, 0);
  });

  test("rate limit por usuário retorna 429 RATE_LIMITED", async () => {
    resetDefaults();
    rateLimitImpl = async () => ({ limited: true, remaining: 0, resetAt: 60_000, limit: 20 });
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com" }));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error.code, "RATE_LIMITED");
    // limite por usuário autenticado, não por IP
    assert.deepEqual(rateLimitCalls, [{ key: "analyze:u-1", opts: { max: 20, windowMs: 60_000 } }]);
    assert.equal(analyzeCalls.length, 0);
    // url ainda não foi lida do body: nenhuma falha de URL é registrada
    assert.equal(failureCalls.length, 0);
  });

  // ─── Validação do body ───

  test("JSON inválido retorna 400 INVALID_JSON", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeInvalidJsonRequest());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "INVALID_JSON");
  });

  test("body sem url retorna 400 VALIDATION_ERROR", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({}));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(analyzeCalls.length, 0);
  });

  test("url com esquema não-HTTP retorna 400 VALIDATION_ERROR", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "ftp://example.com/arquivo" }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(analyzeCalls.length, 0);
  });

  // ─── Gating por plano ───

  test("deepCrawl no plano free retorna 402 UPGRADE_REQUIRED e não chama analyzePage", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com", deepCrawl: true }));
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.error.code, "UPGRADE_REQUIRED");
    assert.equal(analyzeCalls.length, 0);
    assert.equal(saveCalls.length, 0);
  });

  test("plano sem protectedVideo remove assets vturb do resultado", async () => {
    resetDefaults();
    analyzeImpl = async (url) => ({
      url,
      totalFound: 2,
      assets: [asset(), asset({ url: "https://cdn.example.com/v.mp4", sourceTag: "vturb-player" })],
    });
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalFound, 1);
    assert.equal(body.assets.length, 1);
    assert.equal(body.assets[0].sourceTag, "video");
  });

  test("excedente do limite do plano vira lockedCount e os assets são cortados", async () => {
    resetDefaults();
    planImpl = async () => ({ ...freePlan, limits: { ...freePlan.limits, maxAssets: 1 } });
    analyzeImpl = async (url) => ({
      url,
      totalFound: 2,
      assets: [asset(), asset({ url: "https://cdn.example.com/b.mp4", fileName: "b.mp4" })],
    });
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.assets.length, 1);
    assert.equal(body.lockedCount, 1);
    assert.equal(body.totalFound, 1);
  });

  // ─── Caminho feliz ───

  test("caminho feliz retorna 200 com analysisId e salva no histórico", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com/pagina" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.analysisId, "an-1");
    assert.equal(body.totalFound, 1);
    assert.equal(body.assets.length, 1);
    assert.deepEqual(saveCalls, [{ userId: "u-1", deepCrawl: false }]);
    assert.deepEqual(analyzeCalls, [
      { url: "https://example.com/pagina", deepCrawl: false, opts: { allowJsRendering: false } },
    ]);
    assert.equal(failureCalls.length, 0);
  });

  test("deepCrawl no plano Pro passa deepCrawl=true e allowJsRendering=true", async () => {
    resetDefaults();
    planImpl = async () => proPlan;
    analyzeImpl = async (url) => ({ url, totalFound: 1, assets: [asset()], pagesScanned: 3 });
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com", deepCrawl: true }));
    assert.equal(res.status, 200);
    assert.deepEqual(analyzeCalls, [{ url: "https://example.com", deepCrawl: true, opts: { allowJsRendering: true } }]);
    assert.deepEqual(saveCalls, [{ userId: "u-1", deepCrawl: true }]);
  });

  test("falha ao salvar no histórico não derruba a análise (200 sem analysisId)", async () => {
    resetDefaults();
    saveImpl = async () => {
      throw new Error("db fora do ar");
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.analysisId, undefined);
    assert.equal(body.totalFound, 1);
  });

  // ─── Telemetria e falhas do extrator ───

  test("página sem mídia registra NO_MEDIA em recordUrlFailure", async () => {
    resetDefaults();
    analyzeImpl = async (url) => ({ url, totalFound: 0, assets: [] });
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com/vazia" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalFound, 0);
    assert.equal(failureCalls.length, 1);
    assert.equal(failureCalls[0].reason, "NO_MEDIA");
    assert.equal(failureCalls[0].url, "https://example.com/vazia");
    assert.equal(failureCalls[0].userId, "u-1");
  });

  test("AppError do analyzePage vira a resposta de erro correspondente e registra a falha", async () => {
    resetDefaults();
    analyzeImpl = async () => {
      throw Errors.fetchFailed("Timeout.");
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com/lenta" }));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error.code, "FETCH_FAILED");
    assert.equal(failureCalls.length, 1);
    assert.equal(failureCalls[0].reason, "FETCH_FAILED");
    assert.equal(failureCalls[0].url, "https://example.com/lenta");
  });

  test("erro genérico do analyzePage vira 500 INTERNAL_ERROR sem vazar a mensagem", async () => {
    resetDefaults();
    analyzeImpl = async () => {
      throw new Error("segredo interno");
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://example.com/quebrada" }));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.ok(!JSON.stringify(body).includes("segredo interno"));
    assert.equal(failureCalls.length, 1);
    assert.equal(failureCalls[0].reason, "INTERNAL_ERROR");
  });
});
