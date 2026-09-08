import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, test } from "node:test";

// ─── Stub de rede: intercepta @/server/safe-fetch em tempo de resolução ───
// O módulo real faria DNS + HTTP reais; aqui delegamos a um handler global
// configurável por teste, sem tocar na rede.

interface FakeResponseSpec {
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  body?: string;
  throw?: Error;
}

// Cada URL mapeia para uma FILA de respostas (permite testar retry: 1ª 500, 2ª 200).
let routes = new Map<string, FakeResponseSpec[]>();
let calls: string[] = [];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/safe-fetch" || specifier.endsWith("/server/safe-fetch.ts")) {
      return {
        url: "data:text/javascript,export async function safeFetch(...args){return globalThis.__grabixSafeFetchMock(...args)}",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

(globalThis as Record<string, unknown>).__grabixSafeFetchMock = async (url: string) => {
  calls.push(url);
  const queue = routes.get(url);
  const spec = queue && queue.length > 0 ? (queue.length > 1 ? queue.shift() : queue[0]) : undefined;
  if (spec?.throw) throw spec.throw;
  const status = spec?.status ?? 404;
  const headers = new Headers();
  if (spec?.contentType) headers.set("content-type", spec.contentType);
  if (spec?.contentLength) headers.set("content-length", spec.contentLength);
  const body = spec?.body ?? "not found";
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers,
    text: async () => body,
  };
  return { response, resolvedUrl: url };
};

const { runDeepCrawl } = await import("../../src/lib/crawl/orchestrator.ts");

const ROOT = "https://exemplo.com/";
const HTML = "text/html";
const LONG_TEXT = "Lorem ipsum dolor sit amet. ".repeat(30); // > 500 chars → não-SPA

interface CrawlEvent {
  event: string;
  data: Record<string, unknown>;
}

// O tipo EventEmitter do orquestrador é genérico (evento → payload tipado);
// para o spy aceitar qualquer evento usamos `unknown` e estreitamos ao registrar.
function makeEmitter(events: CrawlEvent[]) {
  return (event: unknown, data: unknown) => {
    events.push({ event: event as string, data: data as Record<string, unknown> });
  };
}

function htmlPage(title: string, body: string) {
  return `<html><head><title>${title}</title></head><body>${body}</body></html>`;
}

function route(url: string, ...specs: FakeResponseSpec[]) {
  routes.set(url, specs);
}

function htmlRoute(url: string, body: string) {
  route(url, { status: 200, contentType: HTML, body });
}

function eventNames(events: CrawlEvent[]) {
  return events.map((e) => e.event);
}

beforeEach(() => {
  routes = new Map();
  calls = [];
});

// ─── Configuração ───

describe("runDeepCrawl - configuração", () => {
  test("rejeita config inválida (maxDepth acima do permitido)", async () => {
    await assert.rejects(() => runDeepCrawl(ROOT, { maxDepth: 99 }, makeEmitter([])));
  });

  test("rejeita config inválida (maxPages zero)", async () => {
    await assert.rejects(() => runDeepCrawl(ROOT, { maxPages: 0 }, makeEmitter([])));
  });

  test("aplica defaults do schema e os emite em crawl_started", async () => {
    htmlRoute(ROOT, htmlPage("Home", LONG_TEXT));
    const events: CrawlEvent[] = [];
    await runDeepCrawl(ROOT, {}, makeEmitter(events));

    const started = events.find((e) => e.event === "crawl_started");
    assert.ok(started);
    const config = started.data.config as Record<string, unknown>;
    assert.equal(config.maxDepth, 2);
    assert.equal(config.maxPages, 20);
    assert.equal(config.maxConcurrent, 5);
    assert.equal(config.followSameDomain, true);
    assert.equal(config.followExternal, false);
    assert.equal(started.data.url, ROOT);
  });
});

// ─── Página única: sucesso ───

describe("runDeepCrawl - página única", () => {
  test("extrai título, converte <img> em MediaItem de imagem e classifica como media", async () => {
    htmlRoute(ROOT, htmlPage("Minha Página", `${LONG_TEXT}<img src="https://cdn.exemplo.com/foto.jpg">`));
    const events: CrawlEvent[] = [];
    const result = await runDeepCrawl(ROOT, {}, makeEmitter(events));

    assert.equal(result.originalUrl, ROOT);
    assert.equal(result.pagesCrawled, 1);
    assert.equal(result.pagesWithErrors, 0);
    assert.equal(result.totalMedia, 1);
    assert.ok(result.crawlDurationMs >= 0);

    const page = result.results[0];
    assert.equal(page.url, ROOT);
    assert.equal(page.depth, 0);
    assert.equal(page.title, "Minha Página");
    assert.equal(page.error, null);
    assert.equal(page.possibleSpa, false);
    assert.equal(page.pageKind, "media");
    assert.equal(page.discoveredFrom, null);
    assert.equal(page.discoveryReason, null);

    const media = page.media[0];
    assert.deepEqual(media, {
      url: "https://cdn.exemplo.com/foto.jpg",
      type: "image",
      platform: null,
      videoId: null,
      title: "foto.jpg",
      thumbnailUrl: "https://cdn.exemplo.com/foto.jpg",
      canonicalUrl: "https://cdn.exemplo.com/foto.jpg",
      contentKind: null,
      confidence: 0.92,
      duration: null,
      source: "img[src]",
      downloadable: true,
      discoveredFrom: ROOT,
      discoveryReason: "dom-extracted-asset",
    });

    assert.deepEqual(eventNames(events), ["crawl_started", "media_found", "crawl_complete"]);
    const complete = events.at(-1)?.data as Record<string, unknown>;
    assert.equal(complete.totalPages, 1);
    assert.equal(complete.totalMedia, 1);
  });

  test("converte <video src> em MediaItem de vídeo (sem thumbnail)", async () => {
    htmlRoute(ROOT, htmlPage("Vídeo", `${LONG_TEXT}<video src="https://cdn.exemplo.com/clip.mp4"></video>`));
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));

    const media = result.results[0].media[0];
    assert.equal(media.type, "video");
    assert.equal(media.contentKind, "video");
    assert.equal(media.thumbnailUrl, null);
    assert.equal(media.source, "video[src]");
    assert.equal(media.downloadable, true);
  });

  test("página com texto longo e sem mídia é classificada como landing (raiz)", async () => {
    htmlRoute(ROOT, htmlPage("Institucional", LONG_TEXT));
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));

    const page = result.results[0];
    assert.equal(page.pageKind, "landing");
    assert.equal(page.possibleSpa, false);
    assert.equal(page.media.length, 0);
  });

  test("página quase vazia é marcada como possível SPA", async () => {
    htmlRoute(ROOT, htmlPage("", '<div id="app"></div>'));
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));

    const page = result.results[0];
    assert.equal(page.possibleSpa, true);
    assert.equal(page.title, null, "título vazio vira null");
    assert.equal(page.pageKind, "landing", "raiz sem sinais continua landing");
  });

  test("título com mais de 200 caracteres é truncado", async () => {
    htmlRoute(ROOT, htmlPage("T".repeat(250), LONG_TEXT));
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));
    assert.equal(result.results[0].title?.length, 200);
  });

  test("página raiz de plataforma de vídeo é classificada como platform", async () => {
    const youtubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    htmlRoute(youtubeUrl, htmlPage("YouTube", LONG_TEXT));
    const result = await runDeepCrawl(youtubeUrl, {}, makeEmitter([]));
    assert.equal(result.results[0].pageKind, "platform");
  });
});

// ─── Erros de fetch e categorização ───

describe("runDeepCrawl - categorização de erros", () => {
  async function expectError(spec: FakeResponseSpec, expected: string) {
    routes = new Map();
    calls = [];
    route(ROOT, spec);
    const events: CrawlEvent[] = [];
    const result = await runDeepCrawl(ROOT, {}, makeEmitter(events));

    const page = result.results[0];
    assert.equal(page.error, expected);
    assert.equal(page.media.length, 0);
    assert.equal(page.title, null);
    assert.equal(page.pageKind, "unknown");
    assert.equal(result.pagesWithErrors, 1);
    assert.equal(result.totalMedia, 0);

    const pageError = events.find((e) => e.event === "page_error");
    assert.ok(pageError, `esperava page_error para ${expected}`);
    assert.equal(pageError.data.error, expected);
    assert.equal(pageError.data.url, ROOT);
    assert.equal(pageError.data.depth, 0);
  }

  test("HTTP 403 → auth_required", async () => {
    await expectError({ status: 403, contentType: HTML, body: "forbidden" }, "auth_required");
  });

  test("HTTP 401 → auth_required", async () => {
    await expectError({ status: 401, contentType: HTML, body: "unauthorized" }, "auth_required");
  });

  test("HTTP 429 → rate_limited", async () => {
    await expectError({ status: 429, contentType: HTML, body: "too many" }, "rate_limited");
  });

  test("HTTP 404 → unknown_error (404 não tem categoria própria)", async () => {
    await expectError({ status: 404, contentType: HTML, body: "not found" }, "unknown_error");
  });

  test("content-type não-HTML → not_html", async () => {
    await expectError({ status: 200, contentType: "application/pdf", body: "%PDF" }, "not_html");
  });

  test("content-length acima de 5MB → too_large (sem ler o corpo)", async () => {
    await expectError(
      { status: 200, contentType: HTML, contentLength: String(6 * 1024 * 1024), body: "pequeno" },
      "too_large",
    );
  });

  test("corpo acima de 5MB sem content-length → too_large", async () => {
    await expectError({ status: 200, contentType: HTML, body: "x".repeat(5 * 1024 * 1024 + 1) }, "too_large");
  });

  test("falha de rede (fetch failed) → unreachable", async () => {
    await expectError({ throw: new TypeError("fetch failed") }, "unreachable");
  });

  test("erro de DNS (ENOTFOUND) → unreachable", async () => {
    await expectError({ throw: new Error("getaddrinfo ENOTFOUND exemplo.com") }, "unreachable");
  });

  test("erro de timeout → timeout", async () => {
    await expectError({ throw: new Error("The request hit the timeout limit") }, "timeout");
  });

  test("AbortError (sinal/timeout de undici) → timeout", async () => {
    await expectError({ throw: new Error("AbortError: The operation was aborted") }, "timeout");
  });

  test("erro de bloqueio SSRF → blocked", async () => {
    await expectError({ throw: new Error("Request blocked: private IP") }, "blocked");
  });

  test("erro genérico → unknown_error", async () => {
    await expectError({ throw: new Error("algo inesperado") }, "unknown_error");
  });
});

// ─── Retry em 5xx ───

describe("runDeepCrawl - retry em erros 5xx", () => {
  test("HTTP 500 seguido de 200: retenta uma vez e tem sucesso", { timeout: 10_000 }, async () => {
    route(
      ROOT,
      { status: 500, contentType: HTML, body: "erro" },
      { status: 200, contentType: HTML, body: htmlPage("Recuperou", LONG_TEXT) },
    );
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));

    assert.equal(calls.length, 2, "deve ter feito exatamente uma retentativa");
    assert.equal(result.results[0].error, null);
    assert.equal(result.results[0].title, "Recuperou");
    assert.equal(result.pagesWithErrors, 0);
  });

  test("HTTP 500 persistente: desiste após uma retentativa → server_error", { timeout: 10_000 }, async () => {
    route(ROOT, { status: 500, contentType: HTML, body: "erro" });
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));

    assert.equal(calls.length, 2, "tentativa original + 1 retry");
    assert.equal(result.results[0].error, "server_error");
    assert.equal(result.pagesWithErrors, 1);
  });

  test("HTTP 502 também dispara retentativa", { timeout: 10_000 }, async () => {
    route(
      ROOT,
      { status: 502, contentType: HTML, body: "bad gateway" },
      { status: 200, contentType: HTML, body: htmlPage("Ok", LONG_TEXT) },
    );
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));
    assert.equal(calls.length, 2);
    assert.equal(result.results[0].error, null);
  });

  test("HTTP 404 NÃO dispara retentativa", async () => {
    route(ROOT, { status: 404, contentType: HTML, body: "not found" });
    await runDeepCrawl(ROOT, {}, makeEmitter([]));
    assert.equal(calls.length, 1);
  });

  test("sinal abortado durante a espera do retry interrompe e reporta server_error", { timeout: 10_000 }, async () => {
    route(ROOT, { status: 500, contentType: HTML, body: "erro" });
    const controller = new AbortController();
    controller.abort();
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]), controller.signal);

    assert.equal(calls.length, 1, "não deve fazer a segunda tentativa");
    assert.equal(result.results[0].error, "server_error");
  });
});

// ─── BFS: descoberta e navegação ───

describe("runDeepCrawl - BFS", () => {
  test("segue links same-domain em profundidade 1 com eventos completos", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/a">Página A</a><a href="/b">Página B</a>`));
    htmlRoute("https://exemplo.com/a", htmlPage("A", LONG_TEXT));
    htmlRoute("https://exemplo.com/b", htmlPage("B", LONG_TEXT));

    const events: CrawlEvent[] = [];
    const result = await runDeepCrawl(ROOT, {}, makeEmitter(events));

    assert.equal(result.pagesCrawled, 3);
    assert.deepEqual(
      result.results.map((r) => r.url).sort(),
      [ROOT, "https://exemplo.com/a", "https://exemplo.com/b"].sort(),
    );

    const pageA = result.results.find((r) => r.url === "https://exemplo.com/a");
    assert.equal(pageA?.depth, 1);
    assert.equal(pageA?.discoveredFrom, ROOT);

    const names = eventNames(events);
    assert.equal(names.filter((n) => n === "page_discovered").length, 2);
    assert.equal(names.filter((n) => n === "page_processing").length, 2);
    assert.equal(names.filter((n) => n === "page_complete").length, 2);
    assert.equal(names[0], "crawl_started");
    assert.equal(names.at(-1), "crawl_complete");

    const discovered = events.find((e) => e.event === "page_discovered");
    assert.equal(discovered?.data.category, "same_domain");
    assert.equal(discovered?.data.depth, 1);
    assert.equal(discovered?.data.fromUrl, ROOT);
  });

  test("respeita maxDepth=1: links da página de profundidade 1 não são seguidos", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/a">A</a>`));
    htmlRoute("https://exemplo.com/a", htmlPage("A", `${LONG_TEXT}<a href="/b">B</a>`));
    htmlRoute("https://exemplo.com/b", htmlPage("B", LONG_TEXT));

    const result = await runDeepCrawl(ROOT, { maxDepth: 1 }, makeEmitter([]));

    assert.equal(result.pagesCrawled, 2);
    assert.ok(!calls.includes("https://exemplo.com/b"));
  });

  test("respeita maxPages: reivindica slots antes de processar", async () => {
    const links = [1, 2, 3, 4, 5].map((i) => `<a href="/p${i}">P${i}</a>`).join("");
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}${links}`));
    for (let i = 1; i <= 5; i++) {
      htmlRoute(`https://exemplo.com/p${i}`, htmlPage(`P${i}`, LONG_TEXT));
    }

    const events: CrawlEvent[] = [];
    const result = await runDeepCrawl(ROOT, { maxPages: 2 }, makeEmitter(events));

    assert.equal(result.pagesCrawled, 2, "raiz + 1 página");
    assert.equal(calls.length, 2);
    assert.equal(
      events.filter((e) => e.event === "page_discovered").length,
      5,
      "page_discovered é emitido para toda a fila, mesmo além de maxPages",
    );
  });

  test("links duplicados com tracking params são normalizados e visitados uma vez", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/a?utm_source=newsletter">A1</a><a href="/a">A2</a>`));
    htmlRoute("https://exemplo.com/a", htmlPage("A", LONG_TEXT));

    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));

    assert.equal(result.pagesCrawled, 2);
    assert.equal(
      calls.filter((u) => u.startsWith("https://exemplo.com/a")).length,
      1,
      "utm_source é removido na normalização e a página é visitada uma única vez",
    );
  });

  test("link para página de login é filtrado (não é nem descoberto)", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/login">Entrar</a>`));
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));
    assert.equal(result.pagesCrawled, 1);
    assert.equal(calls.length, 1);
  });

  test("link externo só é seguido com followExternal=true", async () => {
    const body = htmlPage("Home", `${LONG_TEXT}<a href="https://externo.com/artigo">Artigo</a>`);
    htmlRoute(ROOT, body);
    htmlRoute("https://externo.com/artigo", htmlPage("Artigo", LONG_TEXT));

    const semFollow = await runDeepCrawl(ROOT, { followExternal: false }, makeEmitter([]));
    assert.equal(semFollow.pagesCrawled, 1);

    routes = new Map();
    calls = [];
    htmlRoute(ROOT, body);
    htmlRoute("https://externo.com/artigo", htmlPage("Artigo", LONG_TEXT));
    const comFollow = await runDeepCrawl(ROOT, { followExternal: true }, makeEmitter([]));
    assert.equal(comFollow.pagesCrawled, 2);
  });

  test("link de subdomínio respeita followSubdomains", async () => {
    const body = htmlPage("Home", `${LONG_TEXT}<a href="https://blog.exemplo.com/post">Blog</a>`);
    htmlRoute(ROOT, body);
    htmlRoute("https://blog.exemplo.com/post", htmlPage("Post", LONG_TEXT));

    const semFollow = await runDeepCrawl(ROOT, { followSubdomains: false }, makeEmitter([]));
    assert.equal(semFollow.pagesCrawled, 1);

    routes = new Map();
    calls = [];
    htmlRoute(ROOT, body);
    htmlRoute("https://blog.exemplo.com/post", htmlPage("Post", LONG_TEXT));
    const comFollow = await runDeepCrawl(ROOT, { followSubdomains: true }, makeEmitter([]));
    assert.equal(comFollow.pagesCrawled, 2);
  });

  test("links de navegação (nav/header/footer) são pulados por padrão e seguidos com skipNavigationLinks=false", async () => {
    const body = htmlPage(
      "Home",
      `${LONG_TEXT}<nav><a href="/menu">Menu</a></nav><main><a href="/conteudo">Conteúdo</a></main>`,
    );
    htmlRoute(ROOT, body);
    htmlRoute("https://exemplo.com/menu", htmlPage("Menu", LONG_TEXT));
    htmlRoute("https://exemplo.com/conteudo", htmlPage("Conteúdo", LONG_TEXT));

    const padrao = await runDeepCrawl(ROOT, {}, makeEmitter([]));
    assert.deepEqual(padrao.results.map((r) => r.url).sort(), [ROOT, "https://exemplo.com/conteudo"].sort());

    routes = new Map();
    calls = [];
    htmlRoute(ROOT, body);
    htmlRoute("https://exemplo.com/menu", htmlPage("Menu", LONG_TEXT));
    htmlRoute("https://exemplo.com/conteudo", htmlPage("Conteúdo", LONG_TEXT));
    const semSkip = await runDeepCrawl(ROOT, { skipNavigationLinks: false }, makeEmitter([]));
    assert.equal(semSkip.pagesCrawled, 3);
  });

  test("não revisita a URL raiz quando uma página linka de volta para ela", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/a">A</a>`));
    htmlRoute("https://exemplo.com/a", htmlPage("A", `${LONG_TEXT}<a href="/">Voltar</a>`));

    const result = await runDeepCrawl(ROOT, { maxDepth: 2 }, makeEmitter([]));
    assert.equal(result.pagesCrawled, 2);
    assert.equal(calls.filter((u) => u === ROOT).length, 1);
  });

  test("sinal já abortado no início: processa só a raiz e não descobre páginas", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/a">A</a>`));
    htmlRoute("https://exemplo.com/a", htmlPage("A", LONG_TEXT));

    const controller = new AbortController();
    controller.abort();
    const events: CrawlEvent[] = [];
    const result = await runDeepCrawl(ROOT, {}, makeEmitter(events), controller.signal);

    assert.equal(result.pagesCrawled, 1);
    assert.equal(calls.length, 1);
    assert.equal(events.filter((e) => e.event === "page_discovered").length, 0);
    assert.equal(events.at(-1)?.event, "crawl_complete");
  });

  test("erro em página de profundidade 1 não interrompe as demais", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/quebrada">Q</a><a href="/boa">B</a>`));
    route("https://exemplo.com/quebrada", { status: 403, contentType: HTML, body: "forbidden" });
    htmlRoute("https://exemplo.com/boa", htmlPage("Boa", LONG_TEXT));

    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));

    assert.equal(result.pagesCrawled, 3);
    assert.equal(result.pagesWithErrors, 1);
    const quebrada = result.results.find((r) => r.url === "https://exemplo.com/quebrada");
    assert.equal(quebrada?.error, "auth_required");
    const boa = result.results.find((r) => r.url === "https://exemplo.com/boa");
    assert.equal(boa?.error, null);
  });

  test("aplica rate limit por domínio entre requisições (~500ms)", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/a">A</a>`));
    htmlRoute("https://exemplo.com/a", htmlPage("A", LONG_TEXT));

    const start = Date.now();
    await runDeepCrawl(ROOT, {}, makeEmitter([]));
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 450, `duas páginas no mesmo domínio devem levar ~500ms; levou ${elapsed}ms`);
  });
});

// ─── Deduplicação de mídia entre páginas ───

describe("runDeepCrawl - deduplicação de mídia", () => {
  test("mesma imagem em duas páginas conta uma única vez no total", async () => {
    const img = '<img src="https://cdn.exemplo.com/logo.png">';
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}${img}<a href="/a">A</a>`));
    htmlRoute("https://exemplo.com/a", htmlPage("A", `${LONG_TEXT}${img}`));

    const events: CrawlEvent[] = [];
    const result = await runDeepCrawl(ROOT, {}, makeEmitter(events));

    assert.equal(result.totalMedia, 1);
    assert.equal(result.results[0].media.length, 1);
    assert.equal(result.results[1].media.length, 0);
    assert.equal(events.filter((e) => e.event === "media_found").length, 1);
  });

  test("imagens diferentes em páginas diferentes são somadas", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<img src="https://cdn.exemplo.com/1.png"><a href="/a">A</a>`));
    htmlRoute("https://exemplo.com/a", htmlPage("A", `${LONG_TEXT}<img src="https://cdn.exemplo.com/2.png">`));

    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));
    assert.equal(result.totalMedia, 2);
  });
});

// ─── Plataformas de vídeo ───

describe("runDeepCrawl - plataformas de vídeo", () => {
  const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const bodyComYoutube = htmlPage("Home", `${LONG_TEXT}<a href="${YT}">Assista ao vídeo</a>`);

  test("link YouTube vira MediaItem de vídeo não-baixável e não é crawlado", async () => {
    htmlRoute(ROOT, bodyComYoutube);
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));

    const media = result.results[0].media[0];
    assert.equal(media.type, "video");
    assert.equal(media.platform, "youtube");
    assert.equal(media.videoId, "dQw4w9WgXcQ");
    assert.equal(media.url, YT);
    assert.equal(media.canonicalUrl, YT);
    assert.equal(media.contentKind, "video");
    assert.equal(media.thumbnailUrl, "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
    assert.equal(media.downloadable, false);
    assert.equal(media.source, "link");
    assert.equal(media.discoveredFrom, ROOT);
    assert.equal(result.results[0].pageKind, "media");

    assert.ok(
      calls.every((u) => !u.includes("youtube.com")),
      "links de plataforma de vídeo não devem ser crawlados",
    );
  });

  test("com followVideoPlatforms=false o link não vira mídia (mas a página ainda classifica como media)", async () => {
    htmlRoute(ROOT, bodyComYoutube);
    const result = await runDeepCrawl(ROOT, { followVideoPlatforms: false }, makeEmitter([]));

    assert.equal(result.results[0].media.length, 0);
    // Comportamento real: videoPlatformLinks entra na classificação mesmo sem follow.
    assert.equal(result.results[0].pageKind, "media");
  });

  test("link YouTube dentro de <nav> não vira mídia estrutural", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<nav><a href="${YT}">Canal</a></nav>`));
    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));
    assert.equal(result.results[0].media.length, 0);
  });
});

// ─── Classificação de página (pageKind) ───

describe("runDeepCrawl - classificação de página", () => {
  test("raiz com 3+ links content-hub é classificada como hub", async () => {
    const links = [1, 2, 3].map((i) => `<a href="/videos-${i}">videos tutoriais ${i}</a>`).join("");
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}${links}`));

    // maxPages=1 impede o fetch das páginas linkadas; interessa só a classificação.
    const result = await runDeepCrawl(ROOT, { maxPages: 1 }, makeEmitter([]));
    assert.equal(result.results[0].pageKind, "hub");
  });

  test("página de profundidade 1 sem mídia e sem links suficientes é unknown", async () => {
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/vazia">V</a>`));
    htmlRoute("https://exemplo.com/vazia", htmlPage("Vazia", "<div></div>"));

    const result = await runDeepCrawl(ROOT, {}, makeEmitter([]));
    const vazia = result.results.find((r) => r.url === "https://exemplo.com/vazia");
    assert.equal(vazia?.possibleSpa, true);
    assert.equal(vazia?.pageKind, "unknown");
  });

  test("página de profundidade 1 com 5+ links não-navegação é listing", async () => {
    const links = [1, 2, 3, 4, 5].map((i) => `<a href="/item-${i}">Item ${i}</a>`).join("");
    htmlRoute(ROOT, htmlPage("Home", `${LONG_TEXT}<a href="/lista">Lista</a>`));
    htmlRoute("https://exemplo.com/lista", htmlPage("Lista", `${LONG_TEXT}${links}`));

    const result = await runDeepCrawl(ROOT, { maxDepth: 1 }, makeEmitter([]));
    const lista = result.results.find((r) => r.url === "https://exemplo.com/lista");
    assert.equal(lista?.pageKind, "listing");
  });
});
