import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// safeFetch faz fetch real via undici e DNS real via node:dns/promises.
// Ambos são mockados (requer --experimental-test-module-mocks). Sem a flag,
// apenas os caminhos que rejeitam ANTES de qualquer rede (validateUrlFormat)
// são testados — esses não precisam de mock nenhum.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP_NET = "requer node --experimental-test-module-mocks para mockar undici/DNS";

type FetchInit = {
  method?: string;
  headers?: unknown;
  body?: unknown;
  redirect?: string;
  signal?: AbortSignal;
  dispatcher?: unknown;
};
type FetchImpl = (url: string, init: FetchInit) => Promise<Response>;

let fetchImpl: FetchImpl = async () => new Response("ok", { status: 200 });
const fetchCalls: Array<{ url: string; init: FetchInit }> = [];
const dnsLookups: string[] = [];

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
      lookup: (hostname: string, _opts?: unknown) => {
        dnsLookups.push(hostname);
        return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
      },
    },
  });
}

async function importSafeFetch() {
  return import("../../src/server/safe-fetch.ts");
}

function resetSpies(impl?: FetchImpl) {
  fetchCalls.length = 0;
  dnsLookups.length = 0;
  fetchImpl = impl ?? (async () => new Response("ok", { status: 200 }));
}

// ─── Rejeições antes de qualquer rede (sem mock) ───

test("rejeita URL vazia antes de qualquer rede", async () => {
  const { safeFetch } = await importSafeFetch();
  await assert.rejects(
    () => safeFetch("", { timeoutMs: 1000 }),
    (e: unknown) => e instanceof AppError && e.code === "INVALID_URL",
  );
});

test("rejeita URL malformada", async () => {
  const { safeFetch } = await importSafeFetch();
  await assert.rejects(
    () => safeFetch("https://", { timeoutMs: 1000 }),
    (e: unknown) => e instanceof AppError && e.code === "INVALID_URL" && /malformada/.test(e.message),
  );
});

test("rejeita esquemas não-HTTP", async () => {
  const { safeFetch } = await importSafeFetch();
  for (const url of ["file:///etc/passwd", "ftp://example.com/arquivo", "javascript:alert(1)"]) {
    await assert.rejects(
      () => safeFetch(url, { timeoutMs: 1000 }),
      (e: unknown) => e instanceof AppError && e.code === "INVALID_URL",
      url,
    );
  }
});

test("rejeita hostnames privados com SSRF_BLOCKED (403)", async () => {
  const { safeFetch } = await importSafeFetch();
  const privados = [
    "http://localhost/",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.0.1/",
    "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/",
    "http://[::1]/",
  ];
  for (const url of privados) {
    const err = await safeFetch(url, { timeoutMs: 1000 }).catch((e: unknown) => e);
    assert.ok(err instanceof AppError, url);
    assert.equal(err.code, "SSRF_BLOCKED", url);
    assert.equal(err.statusCode, 403, url);
  }
});

// ─── Fluxo completo com fetch/DNS mockados ───

test("resposta 200 direta retorna response e resolvedUrl", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies(async () => new Response("conteudo", { status: 200 }));
  const result = await safeFetch("https://example.com/pagina", { timeoutMs: 1000 });
  assert.equal(result.response.status, 200);
  assert.equal(result.resolvedUrl, "https://example.com/pagina");
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(dnsLookups, ["example.com"]);
});

test("aceita input como objeto URL e como string sem esquema", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies();
  const r1 = await safeFetch(new URL("https://example.com/a"), { timeoutMs: 1000 });
  assert.equal(r1.resolvedUrl, "https://example.com/a");
  const r2 = await safeFetch("example.com/b", { timeoutMs: 1000 });
  assert.equal(r2.resolvedUrl, "https://example.com/b", "string sem esquema vira https://");
});

test("status de erro HTTP (404/500) não lança exceção", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  for (const status of [404, 500]) {
    resetSpies(async () => new Response("erro", { status }));
    const result = await safeFetch("https://example.com/x", { timeoutMs: 1000 });
    assert.equal(result.response.status, status);
  }
});

test("segue todos os códigos de redirect (301, 302, 303, 307, 308)", {
  skip: !canMockModules && SKIP_NET,
}, async () => {
  const { safeFetch } = await importSafeFetch();
  for (const code of [301, 302, 303, 307, 308]) {
    let calls = 0;
    resetSpies(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, { status: code, headers: { location: "https://cdn.example.com/final" } });
      }
      return new Response("ok", { status: 200 });
    });
    const result = await safeFetch("https://example.com/inicio", { timeoutMs: 1000 });
    assert.equal(result.resolvedUrl, "https://cdn.example.com/final", `redirect ${code}`);
    assert.equal(result.response.status, 200);
    assert.equal(fetchCalls.length, 2, `redirect ${code}`);
  }
});

test("redirect relativo é resolvido contra a URL atual", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  let calls = 0;
  resetSpies(async () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 302, headers: { location: "../final?q=1" } });
    return new Response("ok", { status: 200 });
  });
  const result = await safeFetch("https://example.com/a/b/c", { timeoutMs: 1000 });
  assert.equal(result.resolvedUrl, "https://example.com/a/final?q=1");
});

test("valida DNS a cada hop do redirect", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  // Hostnames exclusivos: o módulo cacheia DNS por 5 min, então hosts já usados
  // em outros testes não gerariam uma nova chamada de lookup.
  let calls = 0;
  resetSpies(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(null, { status: 301, headers: { location: "https://hopcdn.test/final" } });
    }
    return new Response("ok", { status: 200 });
  });
  await safeFetch("https://hopdns.test/inicio", { timeoutMs: 1000 });
  assert.deepEqual(dnsLookups, ["hopdns.test", "hopcdn.test"]);
});

test("redirect para host privado é bloqueado (SSRF via Location)", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
  const err = await safeFetch("https://example.com/", { timeoutMs: 1000 }).catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "SSRF_BLOCKED");
});

test("redirect sem header Location lança FETCH_FAILED", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies(async () => new Response(null, { status: 302 }));
  const err = await safeFetch("https://example.com/", { timeoutMs: 1000 }).catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "FETCH_FAILED");
  assert.equal(err.statusCode, 502);
  assert.match(err.message, /Redirecionamento sem destino/);
});

test("mais redirects que o padrão (5) lança 'Muitos redirecionamentos'", {
  skip: !canMockModules && SKIP_NET,
}, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies(async () => new Response(null, { status: 301, headers: { location: "https://example.com/loop" } }));
  const err = await safeFetch("https://example.com/loop", { timeoutMs: 1000 }).catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "FETCH_FAILED");
  assert.match(err.message, /Muitos redirecionamentos/);
  assert.equal(fetchCalls.length, 6, "1 tentativa inicial + 5 redirects seguidos");
});

test("exatamente maxRedirects redirects seguidos funciona", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  let calls = 0;
  resetSpies(async () => {
    calls += 1;
    if (calls <= 5)
      return new Response(null, { status: 302, headers: { location: `https://example.com/hop-${calls}` } });
    return new Response("ok", { status: 200 });
  });
  const result = await safeFetch("https://example.com/hop-0", { timeoutMs: 1000 });
  assert.equal(result.resolvedUrl, "https://example.com/hop-5");
  assert.equal(fetchCalls.length, 6);
});

test("maxRedirects=0 rejeita o primeiro redirect", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies(async () => new Response(null, { status: 301, headers: { location: "https://example.com/b" } }));
  const err = await safeFetch("https://example.com/a", { timeoutMs: 1000, maxRedirects: 0 }).catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.match(err.message, /Muitos redirecionamentos/);
  assert.equal(fetchCalls.length, 1);
});

test("maxRedirects customizado é respeitado", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies(async () => new Response(null, { status: 301, headers: { location: "https://example.com/loop" } }));
  const err = await safeFetch("https://example.com/loop", { timeoutMs: 1000, maxRedirects: 2 }).catch(
    (e: unknown) => e,
  );
  assert.ok(err instanceof AppError);
  assert.equal(fetchCalls.length, 3, "1 inicial + 2 redirects");
});

test("init é propagado: method, headers, body, redirect manual, dispatcher e signal", {
  skip: !canMockModules && SKIP_NET,
}, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies();
  await safeFetch("https://example.com/api", {
    timeoutMs: 5000,
    method: "POST",
    headers: { "x-teste": "valor" },
    body: "payload",
  });
  assert.equal(fetchCalls.length, 1);
  const { init } = fetchCalls[0];
  assert.equal(init.method, "POST");
  assert.equal(init.body, "payload");
  assert.deepEqual(init.headers, { "x-teste": "valor" });
  assert.equal(init.redirect, "manual", "redirects devem ser manuais para validar cada hop");
  assert.ok(init.dispatcher, "dispatcher SSRF-guarded deve estar presente");
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.signal?.aborted, false);
});

test("signal externo já abortado é propagado ao fetch", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies();
  await safeFetch("https://example.com/", { timeoutMs: 5000, signal: AbortSignal.abort() });
  assert.equal(fetchCalls[0].init.signal?.aborted, true);
});

test("timeoutMs dispara o signal dentro do prazo", { skip: !canMockModules && SKIP_NET }, async () => {
  const { safeFetch } = await importSafeFetch();
  resetSpies(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("AbortError: The operation was aborted")));
      }),
  );
  const inicio = Date.now();
  await assert.rejects(() => safeFetch("https://example.com/lento", { timeoutMs: 30 }), /abort/i);
  assert.ok(Date.now() - inicio < 2000, "timeout deve disparar bem antes do padrão");
});
