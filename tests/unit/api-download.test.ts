import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { Errors } from "../../src/features/media-downloader/domain/errors.ts";
import type { Plan } from "../../src/server/plans.ts";

// A rota /api/download depende de auth, rate limit, entitlements (quota no DB)
// e do downloadAsset (rede via safeFetch). Tudo é mockado com mock.module
// usando o mesmo especificador que a rota importa, seguindo a convenção de
// tests/unit/auth-guard.test.ts. Sem --experimental-test-module-mocks o
// arquivo inteiro é pulado. buildContentDisposition e handleApiError são
// puros e NÃO são mockados.

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = "requer node --experimental-test-module-mocks para mockar as dependências da rota";

type AuthedUser = { id: string; email?: string | null; name?: string | null };
type RateResult = { limited: boolean; remaining: number; resetAt: number; limit: number };
type QuotaResult = { ok: boolean; used: number; limit: number };
type DownloadResult = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  fileName: string | null;
};

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
  ...freePlan,
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

function bodyStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

let requireUserImpl: () => Promise<AuthedUser> = async () => ({ id: "u-1" });
let rateLimitImpl: () => Promise<RateResult> = async () => ({ limited: false, remaining: 59, resetAt: 0, limit: 60 });
let planImpl: (userId: string) => Promise<Plan> = async () => freePlan;
let consumeImpl: (userId: string, plan: Plan, amount?: number) => Promise<QuotaResult> = async () => ({
  ok: true,
  used: 1,
  limit: 20,
});
let downloadImpl: (url: string, signal: AbortSignal, maxBytes: number) => Promise<DownloadResult> = async () => ({
  stream: bodyStream("video-bytes"),
  contentType: "video/mp4",
  contentLength: 123,
  fileName: "servidor.mp4",
});

const rateLimitCalls: Array<{ key: string; opts?: { max?: number; windowMs?: number } }> = [];
const consumeCalls: Array<{ userId: string; plan: Plan; amount?: number }> = [];
const refundCalls: Array<{ userId: string; plan: Plan; amount?: number }> = [];
const downloadCalls: Array<{ url: string; maxBytes: number }> = [];

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
  mock.module("@/features/media-downloader/application/download-asset", {
    namedExports: {
      downloadAsset: (url: string, signal: AbortSignal, maxBytes: number) => {
        downloadCalls.push({ url, maxBytes });
        return downloadImpl(url, signal, maxBytes);
      },
    },
  });
}

async function importRoute() {
  return import("../../src/app/api/download/route.ts");
}

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

function makeInvalidJsonRequest(): NextRequest {
  return {
    json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

const VALID_BODY = { url: "https://cdn.example.com/video.mp4", fileName: "video.mp4" };

function resetDefaults() {
  requireUserImpl = async () => ({ id: "u-1" });
  rateLimitImpl = async () => ({ limited: false, remaining: 59, resetAt: 0, limit: 60 });
  planImpl = async () => freePlan;
  consumeImpl = async () => ({ ok: true, used: 1, limit: 20 });
  downloadImpl = async () => ({
    stream: bodyStream("video-bytes"),
    contentType: "video/mp4",
    contentLength: 123,
    fileName: "servidor.mp4",
  });
  rateLimitCalls.length = 0;
  consumeCalls.length = 0;
  refundCalls.length = 0;
  downloadCalls.length = 0;
}

describe("POST /api/download", { skip: !canMockModules && SKIP }, () => {
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
    assert.equal(downloadCalls.length, 0);
    assert.equal(consumeCalls.length, 0);
  });

  test("rate limit retorna 429 RATE_LIMITED antes de consumir quota", async () => {
    resetDefaults();
    rateLimitImpl = async () => ({ limited: true, remaining: 0, resetAt: 60_000, limit: 60 });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.deepEqual(rateLimitCalls, [{ key: "dl:u-1", opts: { max: 60, windowMs: 60_000 } }]);
    assert.equal(consumeCalls.length, 0);
    assert.equal(downloadCalls.length, 0);
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

  test("body sem fileName retorna 400 VALIDATION_ERROR", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://cdn.example.com/video.mp4" }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(consumeCalls.length, 0);
    assert.equal(downloadCalls.length, 0);
  });

  test("url inválida retorna 400 VALIDATION_ERROR", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "não-é-url", fileName: "video.mp4" }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(downloadCalls.length, 0);
  });

  // ─── Quota ───

  test("quota excedida retorna 402 QUOTA_EXCEEDED, devolve a reserva e não baixa", async () => {
    resetDefaults();
    consumeImpl = async () => ({ ok: false, used: 21, limit: 20 });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.error.code, "QUOTA_EXCEEDED");
    assert.equal(consumeCalls.length, 1);
    assert.equal(refundCalls.length, 1);
    assert.equal(refundCalls[0].userId, "u-1");
    assert.equal(downloadCalls.length, 0);
  });

  // ─── Caminho feliz ───

  test("caminho feliz: 200 com stream, headers e quota consumida sem refund", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "video/mp4");
    assert.equal(res.headers.get("content-length"), "123");
    const disposition = res.headers.get("content-disposition") ?? "";
    // fileName do servidor (Content-Disposition) tem precedência sobre o do input
    assert.match(disposition, /servidor\.mp4/);
    assert.match(disposition, /^attachment;/);
    assert.equal(await res.text(), "video-bytes");
    assert.equal(consumeCalls.length, 1);
    assert.equal(consumeCalls[0].userId, "u-1");
    assert.equal(consumeCalls[0].plan, freePlan);
    assert.equal(refundCalls.length, 0);
    assert.deepEqual(downloadCalls, [
      { url: "https://cdn.example.com/video.mp4", maxBytes: freePlan.limits.maxFileSizeBytes },
    ]);
  });

  test("usa o fileName do input quando o servidor não informa um", async () => {
    resetDefaults();
    downloadImpl = async () => ({
      stream: bodyStream("x"),
      contentType: "video/mp4",
      contentLength: 1,
      fileName: null,
    });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /video\.mp4/);
  });

  test("sem content-length o header Content-Length não é enviado", async () => {
    resetDefaults();
    downloadImpl = async () => ({
      stream: bodyStream("x"),
      contentType: "image/jpeg",
      contentLength: null,
      fileName: "foto.jpg",
    });
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "https://cdn.example.com/foto.jpg", fileName: "foto.jpg" }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), null);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
  });

  test("limite de tamanho do plano Pro é repassado ao downloadAsset", async () => {
    resetDefaults();
    planImpl = async () => proPlan;
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    assert.equal(downloadCalls[0].maxBytes, proPlan.limits.maxFileSizeBytes);
  });

  // ─── Falhas do download ───

  test("AppError do downloadAsset devolve a quota e vira a resposta de erro correspondente", async () => {
    resetDefaults();
    downloadImpl = async () => {
      throw Errors.fileTooLarge();
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "FILE_TOO_LARGE");
    assert.equal(refundCalls.length, 1);
    assert.equal(refundCalls[0].userId, "u-1");
  });

  test("erro genérico do downloadAsset devolve a quota e vira 500 INTERNAL_ERROR", async () => {
    resetDefaults();
    downloadImpl = async () => {
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
