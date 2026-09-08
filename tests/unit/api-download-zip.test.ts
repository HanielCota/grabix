import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { Errors } from "../../src/features/media-downloader/domain/errors.ts";
import type { MediaAsset } from "../../src/features/media-downloader/domain/types.ts";
import type { Plan } from "../../src/server/plans.ts";

// A rota /api/download-zip depende de auth, rate limit, entitlements (quota no
// DB) e do createZipStream (rede + archiver). Tudo é mockado com mock.module
// usando o mesmo especificador que a rota importa, seguindo a convenção de
// tests/unit/auth-guard.test.ts. Sem --experimental-test-module-mocks o
// arquivo inteiro é pulado. buildContentDisposition e handleApiError são
// puros e NÃO são mockados.

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = "requer node --experimental-test-module-mocks para mockar as dependências da rota";

type AuthedUser = { id: string; email?: string | null; name?: string | null };
type RateResult = { limited: boolean; remaining: number; resetAt: number; limit: number };
type QuotaResult = { ok: boolean; used: number; limit: number };
type ZipOptions = { maxZipBytes: number; concurrency: number };

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

let requireUserImpl: () => Promise<AuthedUser> = async () => ({ id: "u-1" });
let rateLimitImpl: () => Promise<RateResult> = async () => ({ limited: false, remaining: 19, resetAt: 0, limit: 20 });
let planImpl: (userId: string) => Promise<Plan> = async () => freePlan;
let consumeImpl: (userId: string, plan: Plan, amount?: number) => Promise<QuotaResult> = async () => ({
  ok: true,
  used: 2,
  limit: 20,
});
let zipImpl: (assets: MediaAsset[], signal: AbortSignal, opts: ZipOptions) => Promise<Readable> = async () =>
  Readable.from([Buffer.from("zip-bytes")]);

const rateLimitCalls: Array<{ key: string; opts?: { max?: number; windowMs?: number } }> = [];
const consumeCalls: Array<{ userId: string; plan: Plan; amount?: number }> = [];
const refundCalls: Array<{ userId: string; plan: Plan; amount?: number }> = [];
const zipCalls: Array<{ assets: MediaAsset[]; opts: ZipOptions }> = [];

if (canMockModules) {
  mock.module("@/server/auth-guard", {
    namedExports: { requireUser: () => requireUserImpl() },
  });
  mock.module("@/server/rate-limit", {
    namedExports: {
      checkRateLimit: (key: string, opts?: { max?: number; windowMs?: number }) => {
        rateLimitCalls.push({ key, opts });
        return rateLimitImpl();
      },
    },
  });
  mock.module("@/server/entitlements", {
    namedExports: {
      getUserPlan: (userId: string) => planImpl(userId),
      consumeDownloadQuota: (userId: string, plan: Plan, amount?: number) => {
        consumeCalls.push({ userId, plan, amount });
        return consumeImpl(userId, plan, amount);
      },
      refundDownloadQuota: (userId: string, plan: Plan, amount?: number) => {
        refundCalls.push({ userId, plan, amount });
        return Promise.resolve();
      },
    },
  });
  mock.module("@/features/media-downloader/application/download-zip", {
    namedExports: {
      createZipStream: (assets: MediaAsset[], signal: AbortSignal, opts: ZipOptions) => {
        zipCalls.push({ assets, opts });
        return zipImpl(assets, signal, opts);
      },
    },
  });
}

async function importRoute() {
  return import("../../src/app/api/download-zip/route.ts");
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
    json: () => Promise.reject(new SyntaxError("Unexpected token } in JSON")),
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

const VALID_BODY = { assets: [asset(), asset({ url: "https://cdn.example.com/b.mp4", fileName: "b.mp4" })] };

function resetDefaults() {
  requireUserImpl = async () => ({ id: "u-1" });
  rateLimitImpl = async () => ({ limited: false, remaining: 19, resetAt: 0, limit: 20 });
  planImpl = async () => freePlan;
  consumeImpl = async () => ({ ok: true, used: 2, limit: 20 });
  zipImpl = async () => Readable.from([Buffer.from("zip-bytes")]);
  rateLimitCalls.length = 0;
  consumeCalls.length = 0;
  refundCalls.length = 0;
  zipCalls.length = 0;
}

describe("POST /api/download-zip", { skip: !canMockModules && SKIP }, () => {
  // ─── Autenticação e rate limit ───

  test("sem sessão retorna 401 UNAUTHORIZED", async () => {
    resetDefaults();
    requireUserImpl = async () => {
      throw Errors.unauthorized();
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
    assert.equal(zipCalls.length, 0);
    assert.equal(consumeCalls.length, 0);
  });

  test("rate limit retorna 429 RATE_LIMITED antes de consumir quota", async () => {
    resetDefaults();
    rateLimitImpl = async () => ({ limited: true, remaining: 0, resetAt: 60_000, limit: 20 });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.deepEqual(rateLimitCalls, [{ key: "zip:u-1", opts: { max: 20, windowMs: 60_000 } }]);
    assert.equal(consumeCalls.length, 0);
    assert.equal(zipCalls.length, 0);
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

  test("body sem assets retorna 400 VALIDATION_ERROR", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({}));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(zipCalls.length, 0);
  });

  test("lista de assets vazia retorna 400 VALIDATION_ERROR", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ assets: [] }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(zipCalls.length, 0);
  });

  test("asset com extensão não-mídia retorna 400 VALIDATION_ERROR", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ assets: [asset({ extension: "exe" as MediaAsset["extension"] })] }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(zipCalls.length, 0);
  });

  // ─── Limites do plano e quota ───

  test("mais assets que o limite do plano retorna 400 TOO_MANY_ASSETS", async () => {
    resetDefaults();
    const assets = Array.from({ length: freePlan.limits.maxAssets + 1 }, (_, i) =>
      asset({ url: `https://cdn.example.com/${i}.mp4`, fileName: `${i}.mp4` }),
    );
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ assets }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "TOO_MANY_ASSETS");
    assert.equal(consumeCalls.length, 0);
    assert.equal(zipCalls.length, 0);
  });

  test("quota excedida retorna 402 QUOTA_EXCEEDED, devolve a reserva total e não gera ZIP", async () => {
    resetDefaults();
    consumeImpl = async () => ({ ok: false, used: 22, limit: 20 });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.error.code, "QUOTA_EXCEEDED");
    // ZIP conta 1 download por arquivo: reserva e refund usam assets.length
    assert.equal(consumeCalls.length, 1);
    assert.equal(consumeCalls[0].amount, 2);
    assert.equal(refundCalls.length, 1);
    assert.equal(refundCalls[0].amount, 2);
    assert.equal(zipCalls.length, 0);
  });

  // ─── Caminho feliz ───

  test("caminho feliz: 200 application/zip com stream e opções do plano", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.match(res.headers.get("content-disposition") ?? "", /grabix-media\.zip/);
    assert.equal(await res.text(), "zip-bytes");
    assert.equal(consumeCalls.length, 1);
    assert.equal(consumeCalls[0].amount, 2);
    assert.equal(refundCalls.length, 0);
    assert.equal(zipCalls.length, 1);
    assert.equal(zipCalls[0].assets.length, 2);
    assert.deepEqual(zipCalls[0].opts, {
      maxZipBytes: freePlan.limits.maxZipSizeBytes,
      concurrency: freePlan.limits.maxConcurrentDownloads,
    });
  });

  // ─── Falhas na geração do ZIP ───

  test("AppError do createZipStream devolve a quota e vira a resposta de erro correspondente", async () => {
    resetDefaults();
    zipImpl = async () => {
      throw Errors.zipTooLarge();
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "ZIP_TOO_LARGE");
    assert.equal(refundCalls.length, 1);
    assert.equal(refundCalls[0].amount, 2);
  });

  test("erro genérico do createZipStream devolve a quota e vira 500 INTERNAL_ERROR", async () => {
    resetDefaults();
    zipImpl = async () => {
      throw new Error("segredo interno");
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.ok(!JSON.stringify(body).includes("segredo interno"));
    assert.equal(refundCalls.length, 1);
  });
});
