import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";
import { appConfig } from "../../src/server/config.ts";

// fetchPageHtml usa safeFetch (undici + DNS reais). Os testes profundos mockam
// "undici" e "node:dns/promises" via mock.module, que só existe quando o Node
// roda com --experimental-test-module-mocks; sem a flag eles são pulados (skip),
// seguindo a convenção de tests/unit/safe-fetch.test.ts. Os testes de validação
// (antes de qualquer rede) rodam sempre.
//
// allowJsRendering: false torna o teste determinístico (não depende de
// Playwright estar instalado/habilitado no ambiente).

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP_NET = "requer node --experimental-test-module-mocks para mockar undici/DNS";
const NO_JS = { allowJsRendering: false } as const;

type FetchInit = { headers?: Record<string, string>; signal?: AbortSignal };
type FetchImpl = (url: string, init: FetchInit) => Promise<Response>;

let fetchImpl: FetchImpl = async () => new Response("ok");
const fetchCalls: Array<{ url: string; init: FetchInit }> = [];

if (canMockModules) {
  mock.module("undici", {
    namedExports: {
      Agent: class Agent {},
      fetch: (url: string, init: FetchInit) => {
        fetchCalls.push({ url, init });
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

async function importFetcher() {
  return import("../../src/features/media-downloader/infrastructure/html-fetcher.ts");
}

function resetFetch(impl: FetchImpl) {
  fetchCalls.length = 0;
  fetchImpl = impl;
}

function htmlResponse(html: string, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(html, {
    status: init?.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...init?.headers },
  });
}

describe("fetchPageHtml - validação de URL", () => {
  test("rejeita URL vazia", async () => {
    const { fetchPageHtml } = await importFetcher();
    await assert.rejects(
      () => fetchPageHtml("", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /vazia/);
        return true;
      },
    );
  });

  test("rejeita URL só com espaços", async () => {
    const { fetchPageHtml } = await importFetcher();
    await assert.rejects(() => fetchPageHtml("   ", undefined, NO_JS), /vazia/);
  });

  test("rejeita null/undefined", async () => {
    const { fetchPageHtml } = await importFetcher();
    // biome-ignore lint/suspicious/noExplicitAny: testando robustez contra entrada inválida
    await assert.rejects(() => fetchPageHtml(null as any, undefined, NO_JS), /vazia/);
    // biome-ignore lint/suspicious/noExplicitAny: testando robustez contra entrada inválida
    await assert.rejects(() => fetchPageHtml(undefined as any, undefined, NO_JS), /vazia/);
  });
});

describe("fetchPageHtml - erros propagados do safeFetch (sem rede)", () => {
  test("URL malformada propaga INVALID_URL", async () => {
    const { fetchPageHtml } = await importFetcher();
    await assert.rejects(
      () => fetchPageHtml("https://", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /malformada/);
        return true;
      },
    );
  });

  test("esquema não-HTTP propaga INVALID_URL", async () => {
    const { fetchPageHtml } = await importFetcher();
    await assert.rejects(
      () => fetchPageHtml("ftp://example.com/page", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /HTTP e HTTPS/);
        return true;
      },
    );
  });

  test("file:// é rejeitado", async () => {
    const { fetchPageHtml } = await importFetcher();
    await assert.rejects(
      () => fetchPageHtml("file:///etc/passwd", undefined, NO_JS),
      (err: Error & { code?: string }) => err.code === "INVALID_URL",
    );
  });

  test("host privado propaga SSRF_BLOCKED sem retry", async () => {
    const { fetchPageHtml } = await importFetcher();
    await assert.rejects(
      () => fetchPageHtml("http://localhost/admin", undefined, NO_JS),
      (err: Error & { code?: string; statusCode?: number }) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "SSRF_BLOCKED");
        assert.equal(err.statusCode, 403);
        return true;
      },
    );
  });

  test("IPs privados literais são bloqueados", async () => {
    const { fetchPageHtml } = await importFetcher();
    for (const url of [
      "http://127.0.0.1/",
      "http://10.0.0.5/x",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest",
    ]) {
      await assert.rejects(
        () => fetchPageHtml(url, undefined, NO_JS),
        (err: Error & { code?: string }) => err.code === "SSRF_BLOCKED",
        `${url} deveria ser bloqueado`,
      );
    }
  });

  test("IPv6 loopback é bloqueado", async () => {
    const { fetchPageHtml } = await importFetcher();
    await assert.rejects(
      () => fetchPageHtml("http://[::1]/", undefined, NO_JS),
      (err: Error & { code?: string }) => err.code === "SSRF_BLOCKED",
    );
  });

  test("funciona sem o parâmetro opts (JS rendering desabilitado por padrão no ambiente de teste)", async () => {
    const { fetchPageHtml } = await importFetcher();
    await assert.rejects(
      () => fetchPageHtml("http://localhost/"),
      (err: Error & { code?: string }) => err.code === "SSRF_BLOCKED",
    );
  });
});

describe("fetchPageHtml - fluxo HTTP com fetch/DNS mockados", () => {
  test("200 text/html retorna html e resolvedUrl", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => htmlResponse("<html><body>oi</body></html>"));
    const result = await fetchPageHtml("https://example.com/pagina", undefined, NO_JS);
    assert.equal(result.html, "<html><body>oi</body></html>");
    assert.equal(result.resolvedUrl, "https://example.com/pagina");
    assert.equal(fetchCalls.length, 1);
  });

  test("application/xhtml+xml também é aceito", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => htmlResponse("<html/>", { headers: { "content-type": "application/xhtml+xml" } }));
    const result = await fetchPageHtml("https://example.com/", undefined, NO_JS);
    assert.equal(result.html, "<html/>");
  });

  test("content-type não-HTML lança NOT_HTML", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => htmlResponse("{}", { headers: { "content-type": "application/json" } }));
    await assert.rejects(
      () => fetchPageHtml("https://example.com/api", undefined, NO_JS),
      (err: Error & { code?: string }) => err.code === "NOT_HTML",
    );
  });

  test("content-type ausente lança NOT_HTML", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => new Response("<html/>", { status: 200 }));
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => err.code === "NOT_HTML",
    );
  });

  test("content-length acima do limite lança HTML_TOO_LARGE sem ler o corpo", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () =>
      htmlResponse("<html/>", { headers: { "content-length": String(appConfig.limits.maxHtmlSizeBytes + 1) } }),
    );
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => err.code === "HTML_TOO_LARGE",
    );
  });

  test("content-length não-numérico é ignorado", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => htmlResponse("<html>ok</html>", { headers: { "content-length": "abc" } }));
    const result = await fetchPageHtml("https://example.com/", undefined, NO_JS);
    assert.equal(result.html, "<html>ok</html>");
  });

  test("corpo vazio lança FETCH_FAILED", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => htmlResponse(""));
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "FETCH_FAILED");
        assert.match(err.message, /HTML vazio/);
        return true;
      },
    );
  });
});

describe("fetchPageHtml - status HTTP com fetch mockado", () => {
  const statusCases: Array<[number, RegExp]> = [
    [401, /exige login/],
    [404, /nao encontrada/],
    [429, /limitou/],
    [500, /erro interno/],
    [502, /Bad Gateway/],
    [503, /indisponivel/],
  ];

  for (const [status, pattern] of statusCases) {
    test(`status ${status} vira FETCH_FAILED com mensagem amigável`, {
      skip: !canMockModules && SKIP_NET,
    }, async () => {
      const { fetchPageHtml } = await importFetcher();
      resetFetch(async () => htmlResponse("erro", { status }));
      await assert.rejects(
        () => fetchPageHtml("https://example.com/", undefined, NO_JS),
        (err: Error & { code?: string }) => {
          assert.equal(err.code, "FETCH_FAILED");
          assert.match(err.message, pattern);
          return true;
        },
      );
    });
  }

  test("status sem mensagem mapeada usa fallback genérico", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => htmlResponse("erro", { status: 418 }));
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "FETCH_FAILED");
        assert.match(err.message, /status 418/);
        return true;
      },
    );
  });

  test("404 não é retryable: apenas 1 chamada de fetch", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => htmlResponse("erro", { status: 404 }));
    await assert.rejects(() => fetchPageHtml("https://example.com/", undefined, NO_JS));
    assert.equal(fetchCalls.length, 1);
  });
});

describe("fetchPageHtml - retry com identidade de browser", () => {
  test("403 dispara retry com headers de browser e usa o resultado se funcionar", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { fetchPageHtml } = await importFetcher();
    let call = 0;
    resetFetch(async () => {
      call++;
      return call === 1 ? htmlResponse("bloqueado", { status: 403 }) : htmlResponse("<html>liberou</html>");
    });
    const result = await fetchPageHtml("https://example.com/", undefined, NO_JS);
    assert.equal(result.html, "<html>liberou</html>");
    assert.equal(fetchCalls.length, 2);
    // segunda chamada usa a identidade de browser
    assert.match(fetchCalls[1].init.headers?.["User-Agent"] ?? "", /Mozilla\/5\.0 \(Windows NT/);
    // primeira chamada usa a identidade padrão do Grabix
    assert.equal(fetchCalls[0].init.headers?.["User-Agent"], appConfig.userAgent);
  });

  test("se o retry também falha, o erro primário (403) é mantido", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => htmlResponse("bloqueado", { status: 403 }));
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "FETCH_FAILED");
        assert.match(err.message, /Acesso negado/);
        return true;
      },
    );
    assert.equal(fetchCalls.length, 2);
  });

  test("erro de conexão (retryable) também dispara o retry com browser", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { fetchPageHtml } = await importFetcher();
    let call = 0;
    resetFetch(async () => {
      call++;
      if (call === 1) throw new Error("socket hang up", { cause: { code: "ECONNRESET" } });
      return htmlResponse("<html>ok</html>");
    });
    const result = await fetchPageHtml("https://example.com/", undefined, NO_JS);
    assert.equal(result.html, "<html>ok</html>");
    assert.equal(fetchCalls.length, 2);
  });
});

describe("fetchPageHtml - erros de rede e timeout com fetch mockado", () => {
  test("timeout não é retryable e vira FETCH_FAILED", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "FETCH_FAILED");
        assert.match(err.message, /Timeout/);
        return true;
      },
    );
    assert.equal(fetchCalls.length, 1);
  });

  test("AbortError recebe o mesmo tratamento de timeout", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "FETCH_FAILED");
        assert.match(err.message, /Timeout/);
        return true;
      },
    );
  });

  const networkCases: Array<[string, unknown, RegExp]> = [
    ["ENOTFOUND", { code: "ENOTFOUND" }, /Dominio nao encontrado/],
    ["EAI_AGAIN", { code: "EAI_AGAIN" }, /Dominio nao encontrado/],
    ["ECONNREFUSED", { code: "ECONNREFUSED" }, /Conexao recusada/],
    ["ECONNRESET", { code: "ECONNRESET" }, /Conexao encerrada/],
    ["UND_ERR_SOCKET", { code: "UND_ERR_SOCKET" }, /Conexao encerrada/],
    ["ETIMEDOUT", { code: "ETIMEDOUT" }, /Tempo de conexao esgotado/],
    ["UND_ERR_CONNECT_TIMEOUT", { code: "UND_ERR_CONNECT_TIMEOUT" }, /Tempo de conexao esgotado/],
    ["EHOSTUNREACH", { code: "EHOSTUNREACH" }, /Servidor inacessivel/],
    ["ENETUNREACH", { code: "ENETUNREACH" }, /Servidor inacessivel/],
    ["CERT_HAS_EXPIRED", { code: "CERT_HAS_EXPIRED" }, /Certificado SSL invalido/],
    ["ERR_TLS_CERT_ALTNAME_INVALID", { code: "ERR_TLS_CERT_ALTNAME_INVALID" }, /Certificado SSL invalido/],
    ["código desconhecido", { code: "EWEIRD" }, /Erro de rede \(EWEIRD\)/],
  ];

  for (const [label, cause, pattern] of networkCases) {
    test(`mapeia ${label} para mensagem amigável`, { skip: !canMockModules && SKIP_NET }, async () => {
      const { fetchPageHtml } = await importFetcher();
      resetFetch(async () => {
        throw new Error("falha de rede", { cause });
      });
      await assert.rejects(
        () => fetchPageHtml("https://example.com/", undefined, NO_JS),
        (err: Error & { code?: string }) => {
          assert.equal(err.code, "FETCH_FAILED");
          assert.match(err.message, pattern);
          return true;
        },
      );
    });
  }

  test("erro sem code cai na mensagem genérica", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => {
      throw new Error("boom");
    });
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "FETCH_FAILED");
        assert.match(err.message, /Erro de rede\./);
        return true;
      },
    );
  });

  test("err.cause do erro de rede é desembrulhado (undici wrap)", { skip: !canMockModules && SKIP_NET }, async () => {
    const { fetchPageHtml } = await importFetcher();
    resetFetch(async () => {
      throw new Error("fetch failed", { cause: { code: "ECONNREFUSED" } });
    });
    await assert.rejects(
      () => fetchPageHtml("https://example.com/", undefined, NO_JS),
      (err: Error & { code?: string }) => {
        assert.match(err.message, /Conexao recusada/);
        return true;
      },
    );
  });
});
