import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { Errors } from "../../src/features/media-downloader/domain/errors.ts";
import type { Plan } from "../../src/server/plans.ts";

// A rota /api/extract/deep depende de auth, rate limit, entitlements (DB),
// validação de URL/DNS (rede), do orquestrador de crawl (rede) e da telemetria
// de falhas (DB). Tudo é mockado com mock.module usando o mesmo especificador
// que a rota importa, seguindo a convenção de tests/unit/auth-guard.test.ts.
// Sem --experimental-test-module-mocks o arquivo inteiro é pulado.
// O schema zod e o handleApiError são puros e NÃO são mockados.
//
// Detalhe de ordem na rota: o body é parseado e validado ANTES da
// autenticação — erros de JSON/schema retornam 400 mesmo sem sessão.

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = "requer node --experimental-test-module-mocks para mockar as dependências da rota";

type AuthedUser = { id: string; email?: string | null; name?: string | null };
type RateResult = { limited: boolean; remaining: number; resetAt: number; limit: number };
type Emit = (event: string, data: unknown) => void;
type CrawlResult = { totalMedia: number };

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
  features: { deepCrawl: true, jsRendering: true, protectedVideo: true },
  quota: { downloadsPerDay: Number.POSITIVE_INFINITY },
};

let requireUserImpl: () => Promise<AuthedUser> = async () => ({ id: "u-1" });
let rateLimitImpl: () => Promise<RateResult> = async () => ({ limited: false, remaining: 4, resetAt: 0, limit: 5 });
let planImpl: (userId: string) => Promise<Plan> = async () => proPlan;
let validateUrlImpl: (raw: string) => Promise<URL> = async (raw) => new URL(raw);
let validateDnsImpl: (hostname: string) => Promise<void> = async () => {};
let crawlImpl: (url: string, config: Record<string, unknown>, emit: Emit, signal: AbortSignal) => Promise<CrawlResult> =
  async (url, _config, emit) => {
    emit("crawl_started", { url });
    emit("crawl_complete", { totalMedia: 2 });
    return { totalMedia: 2 };
  };

const requireUserCalls: number[] = [];
const rateLimitCalls: Array<{ key: string; opts?: { max?: number; windowMs?: number } }> = [];
const validateUrlCalls: string[] = [];
const dnsCalls: string[] = [];
const crawlCalls: Array<{ url: string; config: Record<string, unknown> }> = [];
const failureCalls: Array<{
  url: string;
  reason: string;
  message?: string | null;
  deepCrawl?: boolean;
  userId?: string | null;
}> = [];

if (canMockModules) {
  mock.module("@/server/auth-guard", {
    namedExports: {
      requireUser: () => {
        requireUserCalls.push(1);
        return requireUserImpl();
      },
    },
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
    namedExports: { getUserPlan: (userId: string) => planImpl(userId) },
  });
  mock.module("@/server/security", {
    namedExports: {
      validateUrlFormat: (raw: string) => {
        validateUrlCalls.push(raw);
        return validateUrlImpl(raw);
      },
      validateDnsResolution: (hostname: string) => {
        dnsCalls.push(hostname);
        return validateDnsImpl(hostname);
      },
    },
  });
  mock.module("@/lib/crawl/orchestrator", {
    namedExports: {
      runDeepCrawl: (url: string, config: Record<string, unknown>, emit: Emit, signal: AbortSignal) => {
        crawlCalls.push({ url, config });
        return crawlImpl(url, config, emit, signal);
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
  return import("../../src/app/api/extract/deep/route.ts");
}

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

function makeInvalidJsonRequest(): NextRequest {
  return {
    json: () => Promise.reject(new SyntaxError("Unexpected token o in JSON")),
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

const VALID_BODY = { url: "https://example.com/pagina" };

function resetDefaults() {
  requireUserImpl = async () => ({ id: "u-1" });
  rateLimitImpl = async () => ({ limited: false, remaining: 4, resetAt: 0, limit: 5 });
  planImpl = async () => proPlan;
  validateUrlImpl = async (raw) => new URL(raw);
  validateDnsImpl = async () => {};
  crawlImpl = async (url, _config, emit) => {
    emit("crawl_started", { url });
    emit("crawl_complete", { totalMedia: 2 });
    return { totalMedia: 2 };
  };
  requireUserCalls.length = 0;
  rateLimitCalls.length = 0;
  validateUrlCalls.length = 0;
  dnsCalls.length = 0;
  crawlCalls.length = 0;
  failureCalls.length = 0;
}

describe("POST /api/extract/deep", { skip: !canMockModules && SKIP }, () => {
  // ─── Parse e validação do body (antes da autenticação) ───

  test("JSON inválido retorna 400 INVALID_JSON antes de autenticar", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeInvalidJsonRequest());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "INVALID_JSON");
    assert.equal(requireUserCalls.length, 0);
  });

  test("body sem url retorna 400 VALIDATION_ERROR antes de autenticar", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({}));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(requireUserCalls.length, 0);
  });

  test("url inválida retorna 400 VALIDATION_ERROR", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ url: "não-é-url" }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(crawlCalls.length, 0);
  });

  // ─── Autenticação, rate limit e plano ───

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
    assert.equal(crawlCalls.length, 0);
  });

  test("rate limit retorna 429 RATE_LIMITED com orçamento apertado por usuário", async () => {
    resetDefaults();
    rateLimitImpl = async () => ({ limited: true, remaining: 0, resetAt: 60_000, limit: 5 });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.deepEqual(rateLimitCalls, [{ key: "deep:u-1", opts: { max: 5, windowMs: 60_000 } }]);
    assert.equal(crawlCalls.length, 0);
  });

  test("plano free retorna 402 UPGRADE_REQUIRED sem validar a URL nem crawlear", async () => {
    resetDefaults();
    planImpl = async () => freePlan;
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.error.code, "UPGRADE_REQUIRED");
    assert.equal(validateUrlCalls.length, 0);
    assert.equal(crawlCalls.length, 0);
  });

  // ─── Validação de URL e DNS (SSRF) ───

  test("URL barrada pela validação de formato retorna 403 SSRF_BLOCKED", async () => {
    resetDefaults();
    validateUrlImpl = async () => {
      throw Errors.ssrfBlocked();
    };
    const { POST } = await importRoute();
    // body com URL pública válida (passa no schema); o bloqueio vem do validateUrlFormat
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, "SSRF_BLOCKED");
    assert.equal(crawlCalls.length, 0);
  });

  test("falha na resolução DNS retorna 502 FETCH_FAILED", async () => {
    resetDefaults();
    validateDnsImpl = async () => {
      throw Errors.fetchFailed("Falha na resolução DNS de example.com");
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error.code, "FETCH_FAILED");
    assert.equal(crawlCalls.length, 0);
  });

  // ─── Caminho feliz (SSE) ───

  test("caminho feliz: 200 text/event-stream com os eventos do crawl", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const text = await res.text();
    assert.ok(text.includes("event: crawl_started"), "deve conter crawl_started");
    assert.ok(text.includes("event: crawl_complete"), "deve conter crawl_complete");
    assert.ok(text.includes("https://example.com/pagina"));
    // URL validada e DNS checado com o hostname normalizado antes do crawl
    assert.deepEqual(validateUrlCalls, ["https://example.com/pagina"]);
    assert.deepEqual(dnsCalls, ["example.com"]);
    assert.equal(crawlCalls.length, 1);
    assert.equal(crawlCalls[0].url, "https://example.com/pagina");
    assert.equal(failureCalls.length, 0);
  });

  test("config parcial do body é repassada ao runDeepCrawl", async () => {
    resetDefaults();
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ ...VALID_BODY, config: { maxDepth: 3, followExternal: true } }));
    assert.equal(res.status, 200);
    await res.text();
    assert.equal(crawlCalls.length, 1);
    assert.equal(crawlCalls[0].config.maxDepth, 3);
    assert.equal(crawlCalls[0].config.followExternal, true);
  });

  // ─── Telemetria e falhas do crawl ───

  test("crawl sem mídia registra NO_MEDIA e ainda assim fecha o stream", async () => {
    resetDefaults();
    crawlImpl = async (_url, _config, emit) => {
      emit("crawl_complete", { totalMedia: 0 });
      return { totalMedia: 0 };
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("event: crawl_complete"));
    assert.equal(failureCalls.length, 1);
    assert.equal(failureCalls[0].reason, "NO_MEDIA");
    assert.equal(failureCalls[0].deepCrawl, true);
    assert.equal(failureCalls[0].userId, "u-1");
  });

  test("erro no crawl emite crawl_error no stream e registra CRAWL_ERROR", async () => {
    resetDefaults();
    crawlImpl = async () => {
      throw new Error("boom do crawler");
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("event: crawl_error"), "deve conter crawl_error");
    assert.ok(text.includes("boom do crawler"), "a mensagem do erro vai no evento SSE");
    assert.equal(failureCalls.length, 1);
    assert.equal(failureCalls[0].reason, "CRAWL_ERROR");
    assert.equal(failureCalls[0].message, "boom do crawler");
  });
});
