import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";
import { appConfig } from "../../src/server/config.ts";

// js-renderer carrega o Playwright via Function("return import('playwright')"),
// um import opaco que não dá para interceptar com mock.module. Os testes abaixo
// cobrem apenas o que é determinístico SEM lançar o Chromium:
//
//  - renderPage aplica as guardas SSRF (validateUrlFormat/validateDnsResolution)
//    ANTES de getBrowser/page.goto, então URLs privadas/internas são rejeitadas
//    sem que o navegador seja iniciado. Como o Playwright está instalado neste
//    repo (via @playwright/test), loadPlaywright() tem sucesso e o fluxo chega
//    às guardas — é isso que permite testar as rejeições de verdade.
//  - isJsRenderingAvailable respeita appConfig.enableJsRendering e cacheia o
//    resultado. appConfig é um objeto simples (parse zod), então os testes
//    mutam a flag e a restauram ao final.
//
// O que NÃO é testável aqui (documentado):
//  - O erro "Playwright não está instalado" — o pacote está instalado no repo.
//  - Renderização real de página pública — lançaria o Chromium (proibido).
//  - Os caches de módulo (loadAttempted/availabilityCache) não são resetáveis;
//    cada teste de disponibilidade importa o módulo com query string única
//    (cache-bust do ESM), a mesma técnica de tests/unit/config.test.ts.

let importCounter = 0;

type RendererModule = typeof import("../../src/lib/rendering/js-renderer.ts");

async function importRenderer(): Promise<RendererModule> {
  return import(`../../src/lib/rendering/js-renderer.ts?case=${importCounter++}`);
}

// Instância única para os testes de SSRF: renderPage não usa os caches de
// disponibilidade, então uma única importação basta.
const rendererPromise = importRenderer();

function withJsRenderingFlag<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const original = appConfig.enableJsRendering;
  appConfig.enableJsRendering = value;
  return fn().finally(() => {
    appConfig.enableJsRendering = original;
  });
}

// ─── Guardas SSRF em renderPage (rejeição antes de lançar o navegador) ───

test("rejeita IPs literais privados com SSRF_BLOCKED (403)", async () => {
  const { renderPage } = await rendererPromise;
  const privados = [
    "http://127.0.0.1/",
    "http://10.0.0.5/interno",
    "http://192.168.0.1/",
    "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/",
    "http://[::1]/",
  ];
  for (const url of privados) {
    const err = await renderPage(url).catch((e: unknown) => e);
    assert.ok(err instanceof AppError, `${url}: esperado AppError, recebido ${String(err)}`);
    assert.equal(err.code, "SSRF_BLOCKED", url);
    assert.equal(err.statusCode, 403, url);
  }
});

test("rejeita localhost e variações com porta", async () => {
  const { renderPage } = await rendererPromise;
  for (const url of ["http://localhost/", "http://localhost:3000/admin", "https://localhost:8443/"]) {
    const err = await renderPage(url).catch((e: unknown) => e);
    assert.ok(err instanceof AppError, url);
    assert.equal(err.code, "SSRF_BLOCKED", url);
  }
});

test("rejeita esquemas não-HTTP com INVALID_URL", async () => {
  const { renderPage } = await rendererPromise;
  for (const url of [
    "file:///etc/passwd",
    "file:///C:/Windows/win.ini",
    "ftp://example.com/a",
    "javascript:alert(1)",
  ]) {
    const err = await renderPage(url).catch((e: unknown) => e);
    assert.ok(err instanceof AppError, url);
    assert.equal(err.code, "INVALID_URL", url);
  }
});

test("rejeita URL vazia e malformada com INVALID_URL", async () => {
  const { renderPage } = await rendererPromise;
  for (const url of ["", "   ", "https://"]) {
    const err = await renderPage(url).catch((e: unknown) => e);
    assert.ok(err instanceof AppError, JSON.stringify(url));
    assert.equal(err.code, "INVALID_URL", JSON.stringify(url));
  }
});

test("a guarda SSRF vale mesmo com a renderização JS habilitada", async () => {
  const { renderPage } = await importRenderer();
  await withJsRenderingFlag(true, async () => {
    const err = await renderPage("http://169.254.169.254/latest/meta-data").catch((e: unknown) => e);
    assert.ok(err instanceof AppError);
    assert.equal(err.code, "SSRF_BLOCKED");
  });
});

// ─── isJsRenderingAvailable: flag de configuração ───

test("retorna false quando enableJsRendering está desligado", async () => {
  const { isJsRenderingAvailable } = await importRenderer();
  await withJsRenderingFlag(false, async () => {
    assert.equal(await isJsRenderingAvailable(), false);
  });
});

test("retorna true quando habilitado e o Playwright está instalado", async () => {
  const { isJsRenderingAvailable } = await importRenderer();
  // Playwright é devDependency (via @playwright/test), então loadPlaywright()
  // tem sucesso sem lançar navegador — apenas o módulo é carregado.
  await withJsRenderingFlag(true, async () => {
    assert.equal(await isJsRenderingAvailable(), true);
  });
});

// ─── isJsRenderingAvailable: cache de disponibilidade ───

test("cacheia o resultado: mudar a flag depois não altera a resposta (true → false)", async () => {
  const { isJsRenderingAvailable } = await importRenderer();
  const original = appConfig.enableJsRendering;
  try {
    appConfig.enableJsRendering = true;
    assert.equal(await isJsRenderingAvailable(), true);
    // Se não houvesse cache, esta segunda chamada releria a flag e daria false.
    appConfig.enableJsRendering = false;
    assert.equal(await isJsRenderingAvailable(), true, "segunda chamada deve vir do cache");
  } finally {
    appConfig.enableJsRendering = original;
  }
});

test("cacheia o resultado: mudar a flag depois não altera a resposta (false → true)", async () => {
  const { isJsRenderingAvailable } = await importRenderer();
  const original = appConfig.enableJsRendering;
  try {
    appConfig.enableJsRendering = false;
    assert.equal(await isJsRenderingAvailable(), false);
    appConfig.enableJsRendering = true;
    assert.equal(await isJsRenderingAvailable(), false, "segunda chamada deve vir do cache");
  } finally {
    appConfig.enableJsRendering = original;
  }
});

test("cada importação nova tem cache próprio (cache é de módulo, não global)", async () => {
  const primeiro = await importRenderer();
  const original = appConfig.enableJsRendering;
  try {
    appConfig.enableJsRendering = false;
    assert.equal(await primeiro.isJsRenderingAvailable(), false);

    // Um cache-bust novo reavalia a flag — prova que o cache vive no módulo.
    const segundo = await importRenderer();
    appConfig.enableJsRendering = true;
    assert.equal(await segundo.isJsRenderingAvailable(), true);

    // E o primeiro módulo continua com o valor cacheado.
    assert.equal(await primeiro.isJsRenderingAvailable(), false);
  } finally {
    appConfig.enableJsRendering = original;
  }
});
