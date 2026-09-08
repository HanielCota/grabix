import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { config, proxy } from "../../src/proxy.ts";

// Cada teste que consome rate limit usa um IP exclusivo para não contaminar
// os buckets em memória compartilhados entre os testes do arquivo.
let ipSeq = 0;
function freshIp(): string {
  ipSeq += 1;
  return `203.0.113.${ipSeq}`;
}

function makeRequest(path: string, init?: { method?: string; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`, init));
}

function isNext(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

// ─── Rotas fora de /api ───

test("rotas não-API passam direto, sem headers de rate limit", async () => {
  for (const path of ["/", "/pricing", "/sign-in"]) {
    const res = await proxy(makeRequest(path));
    assert.ok(isNext(res), `${path} deve seguir adiante`);
    assert.equal(res.headers.get("X-RateLimit-Limit"), null);
  }
});

// ─── Bypass de auth e webhooks ───

test("/api/auth/* faz bypass do rate limit e do gate de método", async () => {
  const res = await proxy(makeRequest("/api/auth/callback/google", { method: "GET" }));
  assert.ok(isNext(res));
  assert.equal(res.headers.get("X-RateLimit-Limit"), null);
});

test("/api/webhooks/* faz bypass mesmo com POST", async () => {
  const res = await proxy(makeRequest("/api/webhooks/mercadopago", { method: "POST" }));
  assert.ok(isNext(res));
  assert.equal(res.headers.get("X-RateLimit-Limit"), null);
});

// ─── Gate de métodos ───

test("método errado em rota mapeada retorna 405 com Allow e corpo padronizado", async () => {
  const res = await proxy(makeRequest("/api/analyze", { method: "GET" }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "POST");
  const body = await res.json();
  assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
  assert.equal(typeof body.error.message, "string");
});

test("405 vale para todas as rotas mapeadas e métodos errados", async () => {
  for (const [path, method] of [
    ["/api/download", "PUT"],
    ["/api/download-zip", "DELETE"],
    ["/api/extract/deep", "GET"],
  ] as const) {
    const res = await proxy(makeRequest(path, { method }));
    assert.equal(res.status, 405, `${method} ${path} deve ser 405`);
    assert.equal(res.headers.get("Allow"), "POST");
  }
});

test("OPTIONS é permitido em rota mapeada (CORS preflight)", async () => {
  const res = await proxy(makeRequest("/api/analyze", { method: "OPTIONS", headers: { "x-real-ip": freshIp() } }));
  assert.ok(isNext(res));
});

test("rota API não mapeada aceita qualquer método", async () => {
  const res = await proxy(makeRequest("/api/qualquer-coisa", { method: "GET", headers: { "x-real-ip": freshIp() } }));
  assert.ok(isNext(res));
});

test("resposta 405 não consome cota de rate limit", async () => {
  const ip = freshIp();
  await proxy(makeRequest("/api/analyze", { method: "GET", headers: { "x-real-ip": ip } }));
  const res = await proxy(makeRequest("/api/analyze", { method: "POST", headers: { "x-real-ip": ip } }));
  assert.ok(isNext(res));
  assert.equal(res.headers.get("X-RateLimit-Remaining"), "29"); // 1ª contagem real
});

// ─── Limites por rota ───

test("limites por rota: analyze=30, download=60, download-zip=20, deep=10, desconhecida=60", async () => {
  const casos = [
    ["/api/analyze", "30"],
    ["/api/download", "60"],
    ["/api/download-zip", "20"],
    ["/api/extract/deep", "10"],
    ["/api/rota-desconhecida", "60"],
  ] as const;
  for (const [path, limite] of casos) {
    const res = await proxy(makeRequest(path, { method: "POST", headers: { "x-real-ip": freshIp() } }));
    assert.ok(isNext(res), `${path} deve passar`);
    assert.equal(res.headers.get("X-RateLimit-Limit"), limite, `limite de ${path}`);
    assert.equal(res.headers.get("X-RateLimit-Remaining"), String(Number(limite) - 1));
  }
});

test("estouro do limite retorna 429 com headers corretos", async () => {
  const ip = freshIp();
  for (let i = 0; i < 10; i++) {
    const res = await proxy(makeRequest("/api/extract/deep", { method: "POST", headers: { "x-real-ip": ip } }));
    assert.ok(isNext(res), `requisição ${i + 1} deve passar`);
  }
  const res = await proxy(makeRequest("/api/extract/deep", { method: "POST", headers: { "x-real-ip": ip } }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("X-RateLimit-Limit"), "10");
  assert.equal(res.headers.get("X-RateLimit-Remaining"), "0");
  const retryAfter = Number(res.headers.get("Retry-After"));
  assert.ok(Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60);
  const body = await res.json();
  assert.equal(body.error.code, "RATE_LIMITED");
});

test("cota é independente por IP", async () => {
  const ipA = freshIp();
  const ipB = freshIp();
  await proxy(makeRequest("/api/analyze", { method: "POST", headers: { "x-real-ip": ipA } }));
  const resA = await proxy(makeRequest("/api/analyze", { method: "POST", headers: { "x-real-ip": ipA } }));
  assert.equal(resA.headers.get("X-RateLimit-Remaining"), "28");
  const resB = await proxy(makeRequest("/api/analyze", { method: "POST", headers: { "x-real-ip": ipB } }));
  assert.equal(resB.headers.get("X-RateLimit-Remaining"), "29");
});

test("cota é independente por pathname para o mesmo IP", async () => {
  const ip = freshIp();
  await proxy(makeRequest("/api/analyze", { method: "POST", headers: { "x-real-ip": ip } }));
  const res = await proxy(makeRequest("/api/download", { method: "POST", headers: { "x-real-ip": ip } }));
  assert.equal(res.headers.get("X-RateLimit-Remaining"), "59"); // primeira contagem em /api/download
});

// ─── Extração de IP do cliente ───

test("x-real-ip tem precedência sobre x-forwarded-for", async () => {
  const realIp = freshIp();
  const forged = freshIp();
  // Se o XFF fosse usado, as duas requisições compartilhariam o bucket "forged".
  await proxy(
    makeRequest("/api/analyze", { method: "POST", headers: { "x-real-ip": realIp, "x-forwarded-for": forged } }),
  );
  const res = await proxy(makeRequest("/api/analyze", { method: "POST", headers: { "x-forwarded-for": forged } }));
  assert.equal(res.headers.get("X-RateLimit-Remaining"), "29"); // bucket do XFF intacto
});

test("x-forwarded-for: usa o último IP da lista (right-most)", async () => {
  const ultimo = freshIp();
  await proxy(
    makeRequest("/api/analyze", { method: "POST", headers: { "x-forwarded-for": `198.51.100.1, ${ultimo}` } }),
  );
  const res = await proxy(
    makeRequest("/api/analyze", { method: "POST", headers: { "x-forwarded-for": `198.51.100.2, ${ultimo}` } }),
  );
  // Mesmo último IP → mesmo bucket, segunda contagem.
  assert.equal(res.headers.get("X-RateLimit-Remaining"), "28");
});

test("x-real-ip com espaços é normalizado (trim)", async () => {
  const ip = freshIp();
  await proxy(makeRequest("/api/analyze", { method: "POST", headers: { "x-real-ip": ip } }));
  const res = await proxy(makeRequest("/api/analyze", { method: "POST", headers: { "x-real-ip": `  ${ip}  ` } }));
  assert.equal(res.headers.get("X-RateLimit-Remaining"), "28");
});

test("sem headers de IP, cai no bucket 'unknown' e ainda passa", async () => {
  const res = await proxy(makeRequest("/api/rota-sem-ip", { method: "POST" }));
  assert.ok(isNext(res));
  assert.equal(res.headers.get("X-RateLimit-Limit"), "60");
});

// ─── Export de config ───

test("config.matcher cobre apenas rotas de API", () => {
  assert.equal(config.matcher, "/api/:path*");
});
