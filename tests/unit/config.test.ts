import assert from "node:assert/strict";
import { test } from "node:test";

// config.ts avalia process.env no momento do import. Para testar variações de
// ambiente, cada teste importa o módulo com uma query string única (cache-bust
// do ESM) depois de ajustar process.env.

const CONFIG_KEYS = [
  "GRABIX_USER_AGENT",
  "GRABIX_JS_RENDERING",
  "GRABIX_FETCH_TIMEOUT_MS",
  "GRABIX_MAX_HTML_SIZE_BYTES",
  "GRABIX_MAX_ASSETS",
  "GRABIX_MAX_FILE_SIZE_BYTES",
  "GRABIX_MAX_ZIP_SIZE_BYTES",
  "GRABIX_MAX_CONCURRENT_DOWNLOADS",
  "GRABIX_CRAWL_MAX_PAGES",
  "GRABIX_CRAWL_MAX_DEPTH",
  "GRABIX_CRAWL_CONCURRENCY",
  "GRABIX_CRAWL_SAME_DOMAIN_ONLY",
] as const;

let importCounter = 0;

async function importConfigWith(env: Record<string, string | undefined>) {
  const saved = new Map<string, string | undefined>();
  for (const key of CONFIG_KEYS) {
    saved.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const mod = await import(`../../src/server/config.ts?case=${importCounter++}`);
    return mod.appConfig;
  } finally {
    for (const key of CONFIG_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ─── Defaults ───

test("sem variáveis de ambiente, usa todos os defaults", async () => {
  const config = await importConfigWith({});
  assert.match(config.userAgent, /Grabix\/1\.0/);
  assert.equal(config.enableJsRendering, false);
  assert.deepEqual(config.limits, {
    fetchTimeoutMs: 15_000,
    maxHtmlSizeBytes: 10 * 1024 * 1024,
    maxAssets: 200,
    maxFileSizeBytes: 100 * 1024 * 1024,
    maxZipSizeBytes: 500 * 1024 * 1024,
    maxConcurrentDownloads: 5,
  });
  assert.deepEqual(config.crawl, {
    maxPages: 30,
    maxDepth: 2,
    concurrency: 5,
    sameDomainOnly: true,
  });
});

// ─── envInt ───

test("envInt: inteiros válidos sobrescrevem os defaults", async () => {
  const config = await importConfigWith({
    GRABIX_FETCH_TIMEOUT_MS: "3000",
    GRABIX_MAX_ASSETS: "7",
    GRABIX_CRAWL_MAX_PAGES: "12",
    GRABIX_CRAWL_MAX_DEPTH: "0",
  });
  assert.equal(config.limits.fetchTimeoutMs, 3000);
  assert.equal(config.limits.maxAssets, 7);
  assert.equal(config.crawl.maxPages, 12);
  assert.equal(config.crawl.maxDepth, 0); // 0 é válido (nonnegative) e não deve cair no fallback
});

test("envInt: valores não numéricos caem no fallback", async () => {
  const config = await importConfigWith({
    GRABIX_FETCH_TIMEOUT_MS: "abc",
    GRABIX_MAX_ASSETS: "dez",
    GRABIX_CRAWL_MAX_PAGES: "",
  });
  assert.equal(config.limits.fetchTimeoutMs, 15_000);
  assert.equal(config.limits.maxAssets, 200);
  assert.equal(config.crawl.maxPages, 30);
});

test("envInt: parseInt trunca prefixos numéricos", async () => {
  // Number.parseInt("10x") === 10 — comportamento real do código.
  const config = await importConfigWith({ GRABIX_FETCH_TIMEOUT_MS: "10x" });
  assert.equal(config.limits.fetchTimeoutMs, 10);
});

// ─── envBool ───

test("envBool: 'true', 'TRUE' e '1' ligam a flag", async () => {
  for (const value of ["true", "TRUE", "1", "True"]) {
    const config = await importConfigWith({ GRABIX_JS_RENDERING: value });
    assert.equal(config.enableJsRendering, true, `valor=${value}`);
  }
});

test("envBool: qualquer outro valor definido desliga a flag", async () => {
  for (const value of ["false", "0", "yes", "on", "", "2"]) {
    const config = await importConfigWith({ GRABIX_CRAWL_SAME_DOMAIN_ONLY: value });
    assert.equal(config.crawl.sameDomainOnly, false, `valor=${JSON.stringify(value)}`);
  }
});

// ─── envStr ───

test("envStr: string válida sobrescreve o user agent", async () => {
  const config = await importConfigWith({ GRABIX_USER_AGENT: "MeuBot/2.0" });
  assert.equal(config.userAgent, "MeuBot/2.0");
});

test("envStr: valor só com espaços cai no fallback (trim)", async () => {
  const config = await importConfigWith({ GRABIX_USER_AGENT: "   " });
  assert.match(config.userAgent, /Grabix\/1\.0/);
});

test("envStr: valor é trimado antes de usar", async () => {
  const config = await importConfigWith({ GRABIX_USER_AGENT: "  Bot/3.0  " });
  assert.equal(config.userAgent, "Bot/3.0");
});

// ─── Validação zod (limites do schema) ───

test("maxAssets acima de 500 é rejeitado pelo schema", async () => {
  await assert.rejects(() => importConfigWith({ GRABIX_MAX_ASSETS: "501" }));
});

test("maxAssets no teto (500) é aceito", async () => {
  const config = await importConfigWith({ GRABIX_MAX_ASSETS: "500" });
  assert.equal(config.limits.maxAssets, 500);
});

test("maxConcurrentDownloads acima de 10 é rejeitado", async () => {
  await assert.rejects(() => importConfigWith({ GRABIX_MAX_CONCURRENT_DOWNLOADS: "11" }));
});

test("crawl maxPages acima de 50 é rejeitado", async () => {
  await assert.rejects(() => importConfigWith({ GRABIX_CRAWL_MAX_PAGES: "51" }));
});

test("crawl maxDepth acima de 3 é rejeitado", async () => {
  await assert.rejects(() => importConfigWith({ GRABIX_CRAWL_MAX_DEPTH: "4" }));
});

test("crawl concurrency acima de 10 é rejeitado", async () => {
  await assert.rejects(() => importConfigWith({ GRABIX_CRAWL_CONCURRENCY: "11" }));
});

test("valores zero/negativos em campos positive() são rejeitados", async () => {
  await assert.rejects(() => importConfigWith({ GRABIX_FETCH_TIMEOUT_MS: "0" }));
  await assert.rejects(() => importConfigWith({ GRABIX_MAX_FILE_SIZE_BYTES: "-1" }));
});
