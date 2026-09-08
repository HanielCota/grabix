import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { appConfig } from "../../src/server/config.ts";

// analyzePage usa fetchPageHtml -> safeFetch (undici + DNS reais). Os testes
// profundos mockam "undici" e "node:dns/promises" via mock.module, que só
// existe com --experimental-test-module-mocks; sem a flag eles são pulados
// (skip), seguindo a convenção de tests/unit/safe-fetch.test.ts. Os testes de
// validação (antes de qualquer rede) rodam sempre.
//
// mergeAssetsDeduped e o fluxo de tweets já são cobertos por
// tests/unit/analyze-tweet.test.ts e não são repetidos aqui.

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP_NET = "requer node --experimental-test-module-mocks para mockar undici/DNS";
const NO_JS = { allowJsRendering: false } as const;

type FetchInit = { headers?: Record<string, string>; signal?: AbortSignal };
type FetchImpl = (url: string, init: FetchInit) => Promise<Response>;

let fetchImpl: FetchImpl = async () => new Response("ok");
const fetchCalls: string[] = [];

if (canMockModules) {
  mock.module("undici", {
    namedExports: {
      Agent: class Agent {},
      fetch: (url: string, init: FetchInit) => {
        fetchCalls.push(url);
        return fetchImpl(url, init);
      },
    },
  });
  mock.module("node:dns/promises", {
    namedExports: {
      lookup: (_hostname: string, _opts?: unknown) => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    },
  });
}

async function importAnalyzer() {
  return import("../../src/features/media-downloader/application/analyze-page.ts");
}

function resetFetch(impl: FetchImpl) {
  fetchCalls.length = 0;
  fetchImpl = impl;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

describe("analyzePage - validação de entrada (sem rede)", () => {
  test("rejeita URL vazia", async () => {
    const { analyzePage } = await importAnalyzer();
    await assert.rejects(
      () => analyzePage(""),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /vazia/);
        return true;
      },
    );
  });

  test("rejeita URL só com espaços", async () => {
    const { analyzePage } = await importAnalyzer();
    await assert.rejects(() => analyzePage("   "), /vazia/);
  });

  test("rejeita null/undefined", async () => {
    const { analyzePage } = await importAnalyzer();
    // biome-ignore lint/suspicious/noExplicitAny: testando robustez contra entrada inválida
    await assert.rejects(() => analyzePage(null as any), /vazia/);
    // biome-ignore lint/suspicious/noExplicitAny: testando robustez contra entrada inválida
    await assert.rejects(() => analyzePage(undefined as any), /vazia/);
  });

  test("propaga erro de URL malformada do safeFetch", async () => {
    const { analyzePage } = await importAnalyzer();
    await assert.rejects(
      () => analyzePage("https://", false, undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /malformada/);
        return true;
      },
    );
  });

  test("propaga erro de esquema não-HTTP", async () => {
    const { analyzePage } = await importAnalyzer();
    await assert.rejects(
      () => analyzePage("ftp://example.com/file", false, undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /HTTP e HTTPS/);
        return true;
      },
    );
  });

  test("bloqueia hosts privados (SSRF) antes de qualquer fetch", async () => {
    const { analyzePage } = await importAnalyzer();
    await assert.rejects(
      () => analyzePage("http://localhost/pagina", false, undefined, NO_JS),
      (err: Error & { code?: string; statusCode?: number }) => {
        assert.equal(err.code, "SSRF_BLOCKED");
        assert.equal(err.statusCode, 403);
        return true;
      },
    );
  });

  test("bloqueia IP privado literal", async () => {
    const { analyzePage } = await importAnalyzer();
    await assert.rejects(
      () => analyzePage("http://127.0.0.1:8080/admin", false, undefined, NO_JS),
      (err: Error & { code?: string }) => err.code === "SSRF_BLOCKED",
    );
  });
});

describe("analyzePage - fluxo simples (deepCrawl off) com fetch/DNS mockados", () => {
  test("extrai assets do HTML e retorna url/totalFound/assets", { skip: !canMockModules && SKIP_NET }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async () =>
      htmlResponse(
        '<html><body><img src="https://cdn.example.com/pic.jpg"><video src="https://cdn.example.com/v.mp4"></video></body></html>',
      ),
    );
    const result = await analyzePage("https://example.com/pagina", false, undefined, NO_JS);
    assert.equal(result.url, "https://example.com/pagina");
    assert.equal(result.totalFound, 2);
    assert.equal(result.assets.length, 2);
    assert.equal(result.pagesScanned, undefined);
  });

  test("página sem mídia retorna lista vazia e totalFound 0", { skip: !canMockModules && SKIP_NET }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async () => htmlResponse("<html><body><p>nada aqui</p></body></html>"));
    const result = await analyzePage("https://example.com/", false, undefined, NO_JS);
    assert.equal(result.totalFound, 0);
    assert.deepEqual(result.assets, []);
  });

  test("HTML vazio lança FETCH_FAILED", { skip: !canMockModules && SKIP_NET }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async () => htmlResponse(""));
    await assert.rejects(
      () => analyzePage("https://example.com/", false, undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "FETCH_FAILED");
        assert.match(err.message, /HTML vazio/);
        return true;
      },
    );
  });

  test("resolvedUrl é usada como base para URLs relativas", { skip: !canMockModules && SKIP_NET }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async () => htmlResponse('<img src="/img/local.png">'));
    const result = await analyzePage("https://example.com/dir/page", false, undefined, NO_JS);
    assert.equal(result.assets[0].url, "https://example.com/img/local.png");
  });
});

describe("analyzePage - deep crawl com fetch/DNS mockados", () => {
  test("segue links do mesmo domínio e agrega mídia das subpáginas", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async (url) => {
      if (url === "https://example.com/") {
        return htmlResponse('<img src="https://cdn.example.com/root.jpg"><a href="/p2">p2</a>');
      }
      if (url === "https://example.com/p2") {
        return htmlResponse('<video src="https://cdn.example.com/deep.mp4"></video>');
      }
      return htmlResponse("nope", 404);
    });
    const result = await analyzePage("https://example.com/", true, undefined, NO_JS);
    const urls = result.assets.map((a) => a.url).sort();
    assert.deepEqual(urls, ["https://cdn.example.com/deep.mp4", "https://cdn.example.com/root.jpg"]);
    assert.equal(result.pagesScanned, 2);
    assert.equal(result.totalFound, 2);
  });

  test("não segue links de outros domínios (sameDomainOnly)", { skip: !canMockModules && SKIP_NET }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async () =>
      htmlResponse('<img src="https://cdn.example.com/root.jpg"><a href="https://outro.com/p">x</a>'),
    );
    const result = await analyzePage("https://example.com/", true, undefined, NO_JS);
    assert.equal(result.pagesScanned, 1);
    assert.equal(fetchCalls.length, 1);
    assert.equal(result.totalFound, 1);
  });

  test("subpágina que falha é ignorada silenciosamente, mas conta no pagesScanned", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async (url) => {
      if (url === "https://example.com/") {
        return htmlResponse('<img src="https://cdn.example.com/root.jpg"><a href="/quebrada">q</a>');
      }
      return htmlResponse("erro", 500);
    });
    const result = await analyzePage("https://example.com/", true, undefined, NO_JS);
    assert.equal(result.totalFound, 1);
    assert.equal(result.pagesScanned, 2);
  });

  test("links que diferem só por fragmento são visitados uma única vez", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async (url) => {
      if (url === "https://example.com/") {
        return htmlResponse('<a href="/p2#a">a</a><a href="/p2#b">b</a>');
      }
      return htmlResponse("<p>p2</p>");
    });
    const result = await analyzePage("https://example.com/", true, undefined, NO_JS);
    assert.equal(result.pagesScanned, 2);
    assert.equal(fetchCalls.filter((u) => u === "https://example.com/p2").length, 1);
  });

  test("a página inicial não é revisitada (loop via <a href='/'>)", { skip: !canMockModules && SKIP_NET }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async () => htmlResponse('<img src="https://cdn.example.com/root.jpg"><a href="/">home</a>'));
    const result = await analyzePage("https://example.com/", true, undefined, NO_JS);
    assert.equal(result.pagesScanned, 1);
  });

  test("respeita maxPages: no máximo 1 + maxPages-1 subpáginas", { skip: !canMockModules && SKIP_NET }, async () => {
    const { analyzePage } = await importAnalyzer();
    const links = Array.from({ length: 50 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("");
    resetFetch(async (url) => {
      if (url === "https://example.com/") return htmlResponse(links);
      return htmlResponse("<p>sub</p>");
    });
    const result = await analyzePage("https://example.com/", true, undefined, NO_JS);
    assert.equal(result.pagesScanned, appConfig.crawl.maxPages);
  });

  test("mídia duplicada entre páginas é deduplicada", { skip: !canMockModules && SKIP_NET }, async () => {
    const { analyzePage } = await importAnalyzer();
    resetFetch(async (url) => {
      if (url === "https://example.com/") {
        return htmlResponse('<img src="https://cdn.example.com/dup.jpg"><a href="/p2">p2</a>');
      }
      return htmlResponse('<img src="https://cdn.example.com/dup.jpg">');
    });
    const result = await analyzePage("https://example.com/", true, undefined, NO_JS);
    assert.equal(result.totalFound, 1);
  });
});
