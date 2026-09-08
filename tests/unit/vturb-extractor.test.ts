import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, test } from "node:test";
import * as cheerio from "cheerio";

// ─── Stub de rede: intercepta @/server/safe-fetch em tempo de resolução ───
// O módulo real exigiria DNS + HTTP reais; aqui delegamos a um handler global
// configurável por teste, sem tocar na rede.

interface RouteResult {
  status?: number;
  contentType?: string | null;
  body?: string;
  throw?: Error;
}

let routes = new Map<string, RouteResult>();
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
  const route = routes.get(url);
  if (route?.throw) throw route.throw;
  const status = route?.status ?? 404;
  const headers = new Headers();
  if (route?.contentType) headers.set("content-type", route.contentType);
  // Fake mínimo de Response: evita que o construtor real injete um content-type
  // automático ("text/plain") quando o body é string, o que mascararia o teste
  // de "content-type ausente".
  const body = route?.body ?? "not found";
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers,
    text: async () => body,
  };
  return { response, resolvedUrl: url };
};

const { extractVturbVideos } = await import("../../src/lib/vturb/vturb-extractor.ts");

const BASE_URL = "https://meusite.com.br/pagina-de-vendas";
const ACC = "63f8c2a1ab12";
const PLAYER = "7a1b2c3d4e5f";
const VIDEO_ID = "64a1b2c3d4";
const CDN = "cdn-maestro.vturb.com.br";

const JS = "application/javascript";

function v4Config(overrides: { cdn?: string; oid?: string; videoId?: string; cover?: string | null } = {}) {
  const cdn = overrides.cdn ?? CDN;
  const oid = overrides.oid ?? ACC;
  const videoId = overrides.videoId ?? VIDEO_ID;
  const coverLine = overrides.cover === null ? "" : `, cover: "${overrides.cover ?? `https://${CDN}/cover.jpg`}"`;
  return `window.playerConfig = { cdn: "${cdn}", oid: "${oid}", video: { id: "${videoId}"${coverLine} } };`;
}

function playerScriptUrl(subdomain = "scripts", domain = "converteai.net") {
  return `https://${subdomain}.${domain}/${ACC}/players/${PLAYER}/v4/player.js`;
}

function pageWithScriptTag(src: string) {
  return `<html><head><script src="${src}"></script></head><body><h1>Página</h1></body></html>`;
}

function load(html: string) {
  return cheerio.load(html);
}

beforeEach(() => {
  routes = new Map();
  calls = [];
});

// ─── Detecção de referências na página ───

describe("extractVturbVideos - detecção de referências", () => {
  test("página sem nenhuma referência Vturb retorna [] sem fazer fetch", async () => {
    const $ = load("<html><body><p>conteúdo comum</p><script>console.log('oi')</script></body></html>");
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });

  test("script de domínio não-Vturb é ignorado", async () => {
    const $ = load(pageWithScriptTag("https://cdn.jsdelivr.net/npm/lib/player.js"));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });

  test("script src relativo resolvido contra a página (host não-Vturb) é ignorado", async () => {
    const $ = load(pageWithScriptTag("/assets/player.js"));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });

  test("subdomínios e domínios Vturb conhecidos são reconhecidos", async () => {
    const cases = [
      "https://scripts.converteai.net",
      "https://cdn.converteai.net",
      "https://na-cdn.converteai.net",
      "https://cdn-bb.converteai.net",
      "https://cdn-k.converteai.net",
      "https://cdn-cf-bb.converteai.net",
      "https://player.converteai.net",
      "https://images.converteai.net",
      "https://scripts.vturb.com",
      "https://cdn.vturb.com.br",
    ];
    for (const host of cases) {
      routes = new Map();
      calls = [];
      const src = `${host}/${ACC}/players/${PLAYER}/v4/player.js`;
      routes.set(src, { status: 200, contentType: JS, body: v4Config() });
      const $ = load(pageWithScriptTag(src));
      const results = await extractVturbVideos($, BASE_URL);
      assert.equal(results.length, 1, `host não reconhecido: ${host}`);
    }
  });

  test("src protocol-relative (//scripts.converteai.net/...) é resolvido como https", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: JS, body: v4Config() });
    const $ = load(pageWithScriptTag(src.replace(/^https:/, "")));
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
    assert.deepEqual(calls, [src]);
  });

  test("script Vturb sem IDs no path (nem /players/ nem /ab-test/) não gera fetch", async () => {
    const $ = load(pageWithScriptTag("https://scripts.converteai.net/lib/player.js"));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });

  test("mesmo script declarado duas vezes é buscado uma única vez", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: JS, body: v4Config() });
    const $ = load(
      `<html><head><script src="${src}"></script><script src="${src}"></script></head><body></body></html>`,
    );
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
    assert.equal(calls.length, 1);
  });

  test("IDs em maiúsculas no path são aceitos (padrão case-insensitive)", async () => {
    const upperAcc = "63F8C2A1AB12";
    const src = `https://scripts.converteai.net/${upperAcc}/players/${PLAYER.toUpperCase()}/v4/player.js`;
    routes.set(src, { status: 200, contentType: JS, body: v4Config() });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
    assert.equal(results[0].accountId, upperAcc);
  });
});

// ─── Extração via config v4 ───

describe("extractVturbVideos - config v4", () => {
  test("monta a URL HLS https://{cdn}/{oid}/{videoId}/main.m3u8 com metadados", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: JS, body: v4Config() });

    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);

    assert.equal(results.length, 1);
    assert.deepEqual(results[0], {
      url: `https://${CDN}/${ACC}/${VIDEO_ID}/main.m3u8`,
      playerId: PLAYER,
      accountId: ACC,
      thumbnailUrl: `https://${CDN}/cover.jpg`,
      sourceUrl: src,
    });
  });

  test("sem cover no config, thumbnailUrl é null", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: JS, body: v4Config({ cover: null }) });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results[0].thumbnailUrl, null);
  });

  test("suporta poster como alternativa a cover", async () => {
    const src = playerScriptUrl();
    const body = `{ cdn: "${CDN}", oid: "${ACC}", video: { id: "${VIDEO_ID}", poster: "https://${CDN}/poster.png" } }`;
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results[0].thumbnailUrl, `https://${CDN}/poster.png`);
  });

  test("múltiplos video.id no mesmo player.js geram um resultado cada", async () => {
    const src = playerScriptUrl();
    const body = `{ cdn: "${CDN}", oid: "${ACC}", video: { id: "aaa111" } }, { video: { id: "bbb222" } }`;
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results.map((r) => r.url).sort(), [
      `https://${CDN}/${ACC}/aaa111/main.m3u8`,
      `https://${CDN}/${ACC}/bbb222/main.m3u8`,
    ]);
  });

  test("config sem oid cai no fallback legacy", async () => {
    const src = playerScriptUrl();
    const body = `{ cdn: "${CDN}", video: { id: "${VIDEO_ID}" } }; var mediaUrl = "https://cdn.converteai.net/videos/legacy.m3u8";`;
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(
      results.map((r) => r.url),
      ["https://cdn.converteai.net/videos/legacy.m3u8"],
    );
  });

  test("config sem cdn cai no fallback legacy", async () => {
    const src = playerScriptUrl();
    const body = `{ oid: "${ACC}", video: { id: "${VIDEO_ID}" } }; var mediaUrl = "https://cdn.converteai.net/videos/legacy.mp4";`;
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(
      results.map((r) => r.url),
      ["https://cdn.converteai.net/videos/legacy.mp4"],
    );
  });

  test("config com cdn e oid mas sem video.id cai no fallback legacy", async () => {
    const src = playerScriptUrl();
    const body = `{ cdn: "${CDN}", oid: "${ACC}" }; var mediaUrl = "https://cdn.converteai.net/videos/legacy.webm";`;
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(
      results.map((r) => r.url),
      ["https://cdn.converteai.net/videos/legacy.webm"],
    );
  });
});

// ─── Extração legacy ───

describe("extractVturbVideos - fallback legacy", () => {
  test("extrai URLs de chaves mediaUrl/sourceUrl/hlsUrl com extensões de vídeo", async () => {
    const src = playerScriptUrl();
    const body = [
      'var mediaUrl = "https://cdn.converteai.net/videos/a.m3u8";',
      'var source_url = "https://cdn.converteai.net/videos/b.mp4";',
      'var hlsUrl = "https://cdn.converteai.net/videos/c.mpd";',
      'var videoUrl = "https://cdn.converteai.net/videos/d.mov";',
    ].join("\n");
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results.map((r) => r.url).sort(), [
      "https://cdn.converteai.net/videos/a.m3u8",
      "https://cdn.converteai.net/videos/b.mp4",
      "https://cdn.converteai.net/videos/c.mpd",
      "https://cdn.converteai.net/videos/d.mov",
    ]);
    assert.ok(results.every((r) => r.thumbnailUrl === null));
  });

  test("ignora assets estáticos (.js, .css, .png) mesmo em chaves de mídia", async () => {
    const src = playerScriptUrl();
    const body = [
      'var mediaUrl = "https://cdn.converteai.net/app.js";',
      'var sourceUrl = "https://cdn.converteai.net/style.css";',
      'var videoUrl = "https://cdn.converteai.net/cover.png";',
    ].join("\n");
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
  });

  test("extrai URL de CDN Vturb solta no script (sem chave de mídia)", async () => {
    const src = playerScriptUrl();
    const body = 'load("https://na-cdn.converteai.net/x/y/video.mp4?token=abc");';
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(
      results.map((r) => r.url),
      ["https://na-cdn.converteai.net/x/y/video.mp4?token=abc"],
    );
  });

  test("URLs duplicadas no player.js aparecem uma única vez", async () => {
    const src = playerScriptUrl();
    const body =
      'var mediaUrl = "https://cdn.converteai.net/videos/a.m3u8";\nvar backupUrl = "https://cdn.converteai.net/videos/a.m3u8";';
    routes.set(src, { status: 200, contentType: JS, body });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
  });
});

// ─── Iframes ───

describe("extractVturbVideos - iframes", () => {
  test("iframe v4/embed.html gera player.js v4 e legacy sem duplicar o segmento /v4", async () => {
    const v4Url = `https://player.converteai.net/${ACC}/players/${PLAYER}/v4/player.js`;
    const legacyUrl = `https://player.converteai.net/${ACC}/players/${PLAYER}/player.js`;
    routes.set(v4Url, { status: 200, contentType: JS, body: v4Config() });
    routes.set(legacyUrl, { status: 404 });

    const $ = load(
      `<html><body><iframe src="https://player.converteai.net/${ACC}/players/${PLAYER}/v4/embed.html"></iframe></body></html>`,
    );
    const results = await extractVturbVideos($, BASE_URL);

    assert.ok(calls.includes(v4Url), `esperava fetch em ${v4Url}; chamadas: ${calls.join(", ")}`);
    assert.ok(calls.includes(legacyUrl), `esperava fetch em ${legacyUrl}`);
    assert.ok(!calls.some((u) => u.includes("/v4/v4/")), "não pode duplicar o segmento /v4");
    assert.equal(results.length, 1);
    assert.equal(results[0].sourceUrl, v4Url);
    assert.equal(results[0].accountId, ACC);
    assert.equal(results[0].playerId, PLAYER);
  });

  test("iframe com data-src também é detectado", async () => {
    const v4Url = `https://player.converteai.net/${ACC}/players/${PLAYER}/v4/player.js`;
    routes.set(v4Url, { status: 200, contentType: JS, body: v4Config() });
    const $ = load(
      `<html><body><iframe data-src="https://player.converteai.net/${ACC}/players/${PLAYER}/embed.html"></iframe></body></html>`,
    );
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
  });

  test("iframe Vturb sem path /players/{id} é ignorado", async () => {
    const $ = load('<html><body><iframe src="https://player.converteai.net/home"></iframe></body></html>');
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });

  test("iframe de domínio não-Vturb é ignorado", async () => {
    const $ = load(`<html><body><iframe src="https://www.youtube.com/embed/abc"></iframe></body></html>`);
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });
});

// ─── Scripts inline ───

describe("extractVturbVideos - scripts inline", () => {
  test("detecta URL de player.js criada dinamicamente (padrão createElement)", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: JS, body: v4Config() });
    const inline = `
      var s = document.createElement("script"); // smartplayer
      s.src = "${src}";
      document.head.appendChild(s);
    `;
    const $ = load(`<html><head><script>${inline}</script></head><body></body></html>`);
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
    assert.deepEqual(calls, [src]);
  });

  test("hint 'vturb' também habilita a varredura do script inline", async () => {
    const src = playerScriptUrl("cdn", "vturb.com.br");
    routes.set(src, { status: 200, contentType: JS, body: v4Config() });
    const inline = `// vturb loader\nload("${src}");`;
    const $ = load(`<html><head><script>${inline}</script></head><body></body></html>`);
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
  });

  test("script inline sem nenhum hint Vturb é ignorado", async () => {
    // Observação: uma URL de player Vturb sempre contém "converteai"/"vturb",
    // então o gate de hints só é exercitável com scripts sem referência alguma.
    const inline = 'var ga = "https://www.googletagmanager.com/gtag/js"; console.log(ga);';
    const $ = load(`<html><head><script>${inline}</script></head><body></body></html>`);
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });

  test("script inline maior que 500KB é ignorado mesmo com hint e URL válida", async () => {
    const src = playerScriptUrl();
    const inline = `// smartplayer\nvar u = "${src}";\n/* ${"x".repeat(600_000)} */`;
    const $ = load(`<html><head><script>${inline}</script></head><body></body></html>`);
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });

  test("URL de player.js inline sem IDs no path não gera fetch", async () => {
    const inline = '// converteai\nvar u = "https://scripts.converteai.net/static/player.js";';
    const $ = load(`<html><head><script>${inline}</script></head><body></body></html>`);
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
    assert.equal(calls.length, 0);
  });
});

// ─── AB test ───

describe("extractVturbVideos - AB test", () => {
  test("URL /ab-test/ fornece accountId e playerId", async () => {
    const src = `https://scripts.converteai.net/${ACC}/ab-test/${PLAYER}/player.js`;
    routes.set(src, { status: 200, contentType: JS, body: v4Config() });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
    assert.equal(results[0].accountId, ACC);
    assert.equal(results[0].playerId, PLAYER);
  });
});

// ─── Falhas de fetch e validações de resposta ───

describe("extractVturbVideos - respostas do player.js", () => {
  test("resposta não-ok (404) é ignorada silenciosamente", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 404, contentType: JS, body: "not found" });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
  });

  test("content-type inválido (image/png) é rejeitado", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: "image/png", body: v4Config() });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
  });

  test("content-type ausente é rejeitado", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: null, body: v4Config() });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
  });

  test("content-types alternativos aceitos: text/html, application/json, text/plain", async () => {
    for (const contentType of ["text/html", "application/json", "text/plain"]) {
      routes = new Map();
      calls = [];
      const src = playerScriptUrl();
      routes.set(src, { status: 200, contentType, body: v4Config() });
      const $ = load(pageWithScriptTag(src));
      const results = await extractVturbVideos($, BASE_URL);
      assert.equal(results.length, 1, `content-type ${contentType} deveria ser aceito`);
    }
  });

  test("corpo maior que 2MB é descartado", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: JS, body: `/*${"x".repeat(2 * 1024 * 1024 + 1)}*/ ${v4Config()}` });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
  });

  test("corpo vazio é descartado", async () => {
    const src = playerScriptUrl();
    routes.set(src, { status: 200, contentType: JS, body: "" });
    const $ = load(pageWithScriptTag(src));
    const results = await extractVturbVideos($, BASE_URL);
    assert.deepEqual(results, []);
  });

  test("exceção no fetch de um player não afeta os demais", async () => {
    const failing = `https://scripts.converteai.net/${ACC}/players/${PLAYER}/v4/player.js`;
    const okPlayer = "1a2b3c4d5e6f";
    const okSrc = `https://scripts.converteai.net/${ACC}/players/${okPlayer}/v4/player.js`;
    routes.set(failing, { throw: new Error("boom") });
    routes.set(okSrc, { status: 200, contentType: JS, body: v4Config() });

    const $ = load(
      `<html><head><script src="${failing}"></script><script src="${okSrc}"></script></head><body></body></html>`,
    );
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1);
    assert.equal(results[0].playerId, okPlayer);
  });

  test("mesma URL de vídeo vinda de dois players diferentes é deduplicada", async () => {
    const playerB = "1a2b3c4d5e6f";
    const srcA = `https://scripts.converteai.net/${ACC}/players/${PLAYER}/v4/player.js`;
    const srcB = `https://scripts.converteai.net/${ACC}/players/${playerB}/v4/player.js`;
    routes.set(srcA, { status: 200, contentType: JS, body: v4Config() });
    routes.set(srcB, { status: 200, contentType: JS, body: v4Config() });

    const $ = load(
      `<html><head><script src="${srcA}"></script><script src="${srcB}"></script></head><body></body></html>`,
    );
    const results = await extractVturbVideos($, BASE_URL);
    assert.equal(results.length, 1, "a URL do vídeo é a chave de deduplicação");
  });
});
