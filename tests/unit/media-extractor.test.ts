import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as cheerio from "cheerio";
import {
  extractMediaAndLinks,
  extractMediaAndLinksFromDom,
  extractMediaFromHtml,
} from "../../src/features/media-downloader/infrastructure/media-extractor.ts";
import { appConfig } from "../../src/server/config.ts";

const BASE = "https://example.com/page/index.html";

// HTML de teste nunca referencia Vturb/ConvertAI, então extractVturbVideos
// encontra zero scripts e não faz nenhuma chamada de rede.

describe("extractMediaFromHtml - img", () => {
  test("extrai img[src] simples como IMAGE", async () => {
    const assets = await extractMediaFromHtml('<img src="https://cdn.example.com/pic.jpg">', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://cdn.example.com/pic.jpg");
    assert.equal(assets[0].type, "IMAGE");
    assert.equal(assets[0].extension, "jpg");
    assert.equal(assets[0].fileName, "pic.jpg");
    assert.equal(assets[0].sourceTag, "img[src]");
  });

  test("resolve URL relativa contra a base", async () => {
    const assets = await extractMediaFromHtml('<img src="/images/rel.png">', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://example.com/images/rel.png");
  });

  test("suporta atributos lazy-load (data-src, data-lazy-src, data-original)", async () => {
    const html = `
      <img data-src="https://cdn.example.com/a.jpg">
      <img data-lazy-src="https://cdn.example.com/b.jpg">
      <img data-original="https://cdn.example.com/c.jpg">
    `;
    const assets = await extractMediaFromHtml(html, BASE);
    const urls = assets.map((a) => a.url);
    assert.deepEqual(urls.sort(), [
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
      "https://cdn.example.com/c.jpg",
    ]);
  });

  test("extrai URLs de srcset com descritores", async () => {
    const html = '<img srcset="https://cdn.example.com/small.jpg 1x, https://cdn.example.com/large.jpg 2x">';
    const assets = await extractMediaFromHtml(html, BASE);
    const urls = assets.map((a) => a.url).sort();
    assert.deepEqual(urls, ["https://cdn.example.com/large.jpg", "https://cdn.example.com/small.jpg"]);
  });

  test("remove data: URIs do srcset sem quebrar as demais entradas", async () => {
    const html = '<img srcset="data:image/png;base64,iVBORw0KGgo= 1x, https://cdn.example.com/real.png 2x">';
    const assets = await extractMediaFromHtml(html, BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://cdn.example.com/real.png");
  });

  test("deduplica mesma URL vinda de src e srcset", async () => {
    const html = '<img src="https://cdn.example.com/a.jpg" srcset="https://cdn.example.com/a.jpg 1x">';
    const assets = await extractMediaFromHtml(html, BASE);
    assert.equal(assets.length, 1);
  });

  test("img sem nenhum atributo de mídia não gera asset", async () => {
    const assets = await extractMediaFromHtml("<img alt='sem src'>", BASE);
    assert.equal(assets.length, 0);
  });

  test("extensão maiúscula é normalizada, mas fileName preserva o original", async () => {
    const assets = await extractMediaFromHtml('<img src="https://cdn.example.com/PHOTO.JPG">', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "jpg");
    assert.equal(assets[0].fileName, "PHOTO.JPG");
  });

  test("svg é classificado como IMAGE", async () => {
    const assets = await extractMediaFromHtml('<img src="https://cdn.example.com/icon.svg">', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].type, "IMAGE");
  });

  test("extensão não-suportada é ignorada", async () => {
    const assets = await extractMediaFromHtml('<img src="https://cdn.example.com/file.bmp">', BASE);
    assert.equal(assets.length, 0);
  });

  test("query string distingue recursos; fragmento não", async () => {
    const html = `
      <img src="https://cdn.example.com/a.jpg?size=1">
      <img src="https://cdn.example.com/a.jpg?size=2">
      <img src="https://cdn.example.com/b.jpg#x">
      <img src="https://cdn.example.com/b.jpg#y">
    `;
    const assets = await extractMediaFromHtml(html, BASE);
    assert.equal(assets.length, 3);
  });

  test("protocolos não-HTTP são ignorados (data:, ftp:, javascript:)", async () => {
    const html = `
      <img src="data:image/png;base64,AAAA">
      <img src="ftp://cdn.example.com/x.jpg">
      <img src="javascript:alert(1)">
    `;
    const assets = await extractMediaFromHtml(html, BASE);
    assert.equal(assets.length, 0);
  });
});

describe("extractMediaFromHtml - video e source", () => {
  test("extrai video[src] como VIDEO", async () => {
    const assets = await extractMediaFromHtml('<video src="https://cdn.example.com/clip.mp4"></video>', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].type, "VIDEO");
    assert.equal(assets[0].extension, "mp4");
    assert.equal(assets[0].sourceTag, "video[src]");
  });

  test("extrai poster de video como IMAGE", async () => {
    const assets = await extractMediaFromHtml(
      '<video src="https://cdn.example.com/clip.mp4" poster="https://cdn.example.com/cover.jpg"></video>',
      BASE,
    );
    assert.equal(assets.length, 2);
    const poster = assets.find((a) => a.sourceTag === "video[poster]");
    assert.ok(poster);
    assert.equal(poster.type, "IMAGE");
    assert.equal(poster.url, "https://cdn.example.com/cover.jpg");
  });

  test("source sem extensão na URL usa o MIME type como extensão inferida", async () => {
    const assets = await extractMediaFromHtml(
      '<video><source src="https://cdn.example.com/stream" type="video/mp4"></video>',
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "mp4");
    assert.equal(assets[0].type, "VIDEO");
    assert.match(assets[0].fileName, /^media-\d+\.mp4$/);
  });

  test("source sem extensão e sem type é ignorado", async () => {
    const assets = await extractMediaFromHtml('<video><source src="https://cdn.example.com/stream"></video>', BASE);
    assert.equal(assets.length, 0);
  });

  test("source com type desconhecido e sem extensão é ignorado", async () => {
    const assets = await extractMediaFromHtml(
      '<video><source src="https://cdn.example.com/stream" type="application/x-unknown"></video>',
      BASE,
    );
    assert.equal(assets.length, 0);
  });
});

describe("extractMediaFromHtml - links <a>", () => {
  test("a[href] com extensão de mídia vira asset", async () => {
    const assets = await extractMediaFromHtml('<a href="/downloads/movie.mp4">baixar</a>', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://example.com/downloads/movie.mp4");
    assert.equal(assets[0].type, "VIDEO");
    assert.equal(assets[0].sourceTag, "a[href]");
  });

  test("a[href] sem extensão de mídia não vira asset", async () => {
    const assets = await extractMediaFromHtml('<a href="https://example.com/doc.pdf">doc</a>', BASE);
    assert.equal(assets.length, 0);
  });
});

describe("extractMediaFromHtml - noscript e picture", () => {
  test("extrai img dentro de <noscript>", async () => {
    const assets = await extractMediaFromHtml(
      '<noscript><img src="https://cdn.example.com/fallback.png"></noscript>',
      BASE,
    );
    const found = assets.find((a) => a.url === "https://cdn.example.com/fallback.png");
    assert.ok(found);
    assert.equal(found.type, "IMAGE");
  });

  test("<picture> extrai source[srcset] e img de fallback", async () => {
    const html = `
      <picture>
        <source srcset="https://cdn.example.com/art.webp" type="image/webp">
        <img src="https://cdn.example.com/art.jpg">
      </picture>
    `;
    const assets = await extractMediaFromHtml(html, BASE);
    const urls = assets.map((a) => a.url).sort();
    assert.deepEqual(urls, ["https://cdn.example.com/art.jpg", "https://cdn.example.com/art.webp"]);
  });

  test("img dentro de <picture> não é processada duas vezes", async () => {
    const html = `
      <picture>
        <img src="https://cdn.example.com/only.jpg">
      </picture>
    `;
    const assets = await extractMediaFromHtml(html, BASE);
    assert.equal(assets.filter((a) => a.url === "https://cdn.example.com/only.jpg").length, 1);
  });
});

describe("extractMediaFromHtml - CSS background-image", () => {
  test("extrai background-image de style inline", async () => {
    const assets = await extractMediaFromHtml(
      `<div style="background-image: url('https://cdn.example.com/bg.jpg')"></div>`,
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://cdn.example.com/bg.jpg");
    assert.equal(assets[0].sourceTag, "css[background-image]");
  });

  test("extrai background de bloco <style>", async () => {
    const assets = await extractMediaFromHtml("<style>.hero { background: url(/bg2.png) no-repeat; }</style>", BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://example.com/bg2.png");
  });

  test("ignora data: URLs em CSS", async () => {
    const assets = await extractMediaFromHtml(
      `<div style="background-image: url(data:image/png;base64,AAAA)"></div>`,
      BASE,
    );
    assert.equal(assets.length, 0);
  });
});

describe("extractMediaFromHtml - iframes de plataformas de vídeo", () => {
  test("iframe do YouTube (/embed/) gera thumbnail", async () => {
    const assets = await extractMediaFromHtml('<iframe src="https://www.youtube.com/embed/abc123"></iframe>', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://img.youtube.com/vi/abc123/maxresdefault.jpg");
    assert.equal(assets[0].type, "IMAGE");
    assert.equal(assets[0].extension, "jpg");
  });

  test("iframe youtube-nocookie também gera thumbnail", async () => {
    const assets = await extractMediaFromHtml(
      '<iframe src="https://www.youtube-nocookie.com/embed/xyz789"></iframe>',
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://img.youtube.com/vi/xyz789/maxresdefault.jpg");
  });

  test("iframe com protocol-relative URL (//) é reconhecido", async () => {
    const assets = await extractMediaFromHtml('<iframe src="//www.youtube.com/embed/pl123"></iframe>', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://img.youtube.com/vi/pl123/maxresdefault.jpg");
  });

  test("iframe do Vimeo (player.vimeo.com/video/) gera thumbnail do vumbnail", async () => {
    const assets = await extractMediaFromHtml('<iframe src="https://player.vimeo.com/video/12345"></iframe>', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://vumbnail.com/12345.jpg");
  });

  test("iframe de plataforma desconhecida não gera asset", async () => {
    const assets = await extractMediaFromHtml('<iframe src="https://example.com/widget"></iframe>', BASE);
    assert.equal(assets.length, 0);
  });

  test("iframe sem src não gera asset", async () => {
    const assets = await extractMediaFromHtml("<iframe></iframe>", BASE);
    assert.equal(assets.length, 0);
  });
});

describe("extractMediaFromHtml - embed e object", () => {
  test("embed[src] com type de vídeo", async () => {
    const assets = await extractMediaFromHtml('<embed src="https://cdn.example.com/clip.mp4" type="video/mp4">', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].type, "VIDEO");
    assert.equal(assets[0].sourceTag, "embed[src]");
  });

  test("object[data] sem extensão usa o type como inferência", async () => {
    const assets = await extractMediaFromHtml(
      '<object data="https://cdn.example.com/movie" type="video/webm"></object>',
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "webm");
    assert.equal(assets[0].type, "VIDEO");
  });
});

describe("extractMediaFromHtml - meta tags", () => {
  test("og:video vira asset VIDEO com extensão inferida mp4", async () => {
    const assets = await extractMediaFromHtml(
      '<meta property="og:video" content="https://cdn.example.com/v.mp4">',
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].type, "VIDEO");
    assert.equal(assets[0].sourceTag, "meta[og:video]");
  });

  test("meta og:video com URL sem extensão usa mp4 inferido", async () => {
    const assets = await extractMediaFromHtml(
      '<meta property="og:video" content="https://cdn.example.com/stream">',
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "mp4");
  });

  test("og:video apontando para embed do YouTube é ignorado", async () => {
    const assets = await extractMediaFromHtml(
      '<meta property="og:video" content="https://www.youtube.com/embed/abc123">',
      BASE,
    );
    assert.equal(assets.length, 0);
  });

  test("og:video apontando para página do Vimeo é ignorado", async () => {
    const assets = await extractMediaFromHtml('<meta property="og:video" content="https://vimeo.com/12345">', BASE);
    assert.equal(assets.length, 0);
  });

  test("og:image vira asset IMAGE", async () => {
    const assets = await extractMediaFromHtml(
      '<meta property="og:image" content="https://cdn.example.com/thumb.jpg">',
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].type, "IMAGE");
    assert.equal(assets[0].sourceTag, "meta[og:image]");
  });

  test("twitter:player com name= também é lido", async () => {
    const assets = await extractMediaFromHtml(
      '<meta name="twitter:player" content="https://cdn.example.com/player.mp4">',
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].sourceTag, "meta[twitter:player]");
  });
});

describe("extractMediaFromHtml - JSON-LD", () => {
  test("VideoObject extrai contentUrl e thumbnailUrl", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "VideoObject",
      contentUrl: "https://cdn.example.com/vid.mp4",
      thumbnailUrl: "https://cdn.example.com/thumb.jpg",
    })}</script>`;
    const assets = await extractMediaFromHtml(html, BASE);
    assert.equal(assets.length, 2);
    const video = assets.find((a) => a.sourceTag === "json-ld[contentUrl]");
    const thumb = assets.find((a) => a.sourceTag === "json-ld[thumbnailUrl]");
    assert.ok(video);
    assert.ok(thumb);
    assert.equal(video.type, "VIDEO");
    assert.equal(thumb.type, "IMAGE");
  });

  test("suporta array no topo e @graph", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { "@type": "VideoObject", contentUrl: "https://cdn.example.com/a.mp4" },
      { "@graph": [{ "@type": "VideoObject", contentUrl: "https://cdn.example.com/b.mp4" }] },
    ])}</script>`;
    const assets = await extractMediaFromHtml(html, BASE);
    const urls = assets.map((a) => a.url).sort();
    assert.deepEqual(urls, ["https://cdn.example.com/a.mp4", "https://cdn.example.com/b.mp4"]);
  });

  test("contentUrl do YouTube é ignorado", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "VideoObject",
      contentUrl: "https://www.youtube.com/watch?v=abc123",
    })}</script>`;
    const assets = await extractMediaFromHtml(html, BASE);
    assert.equal(assets.length, 0);
  });

  test("tipo não-VideoObject é ignorado", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Article",
      url: "https://example.com/artigo",
    })}</script>`;
    const assets = await extractMediaFromHtml(html, BASE);
    assert.equal(assets.length, 0);
  });

  test("JSON malformado não quebra a extração", async () => {
    const assets = await extractMediaFromHtml(
      '<script type="application/ld+json">{invalid json!!</script><img src="https://cdn.example.com/ok.jpg">',
      BASE,
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://cdn.example.com/ok.jpg");
  });
});

describe("extractMediaFromHtml - scripts inline", () => {
  test("extrai URL de vídeo direta em script", async () => {
    const assets = await extractMediaFromHtml('<script>var v = "https://cdn.example.com/direct.mp4";</script>', BASE);
    assert.ok(assets.some((a) => a.url === "https://cdn.example.com/direct.mp4"));
  });

  test("extrai padrão JW Player file:", async () => {
    const assets = await extractMediaFromHtml(
      `<script>jwplayer("p").setup({ file: "https://cdn.example.com/jw.mp4" });</script>`,
      BASE,
    );
    // O padrão genérico de URL roda antes do padrão JW Player, então a deduplicação
    // mantém o sourceTag "script" - o que importa é a URL ser extraída.
    assert.ok(assets.some((a) => a.url === "https://cdn.example.com/jw.mp4"));
  });

  test('extrai padrão JSON "url":"...mp4"', async () => {
    const assets = await extractMediaFromHtml(
      `<script>var cfg = {"url":"https://cdn.example.com/json.mp4"};</script>`,
      BASE,
    );
    assert.ok(assets.some((a) => a.url === "https://cdn.example.com/json.mp4"));
  });

  test("mesma URL em múltiplos padrões de script é deduplicada", async () => {
    const assets = await extractMediaFromHtml(
      `<script>var cfg = {"file":"https://cdn.example.com/dup.mp4"}; var x = "https://cdn.example.com/dup.mp4";</script>`,
      BASE,
    );
    assert.equal(assets.filter((a) => a.url === "https://cdn.example.com/dup.mp4").length, 1);
  });

  test("scripts maiores que 500k caracteres são ignorados", async () => {
    const bigScript = `<script>var pad = "${"x".repeat(500_001)}"; var v = "https://cdn.example.com/huge.mp4";</script>`;
    const assets = await extractMediaFromHtml(bigScript, BASE);
    assert.equal(assets.length, 0);
  });

  test("script com src externo não é varrido como inline", async () => {
    const assets = await extractMediaFromHtml('<script src="https://cdn.example.com/player.js"></script>', BASE);
    assert.equal(assets.length, 0);
  });
});

describe("extractMediaFromHtml - atributos data-*", () => {
  test("data-video-src com URL de vídeo vira asset", async () => {
    const assets = await extractMediaFromHtml('<div data-video-src="https://cdn.example.com/dv.mp4"></div>', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].type, "VIDEO");
    assert.equal(assets[0].sourceTag, "[data-video-src]");
  });

  test("data-hls com playlist m3u8 vira asset VIDEO", async () => {
    const assets = await extractMediaFromHtml('<div data-hls="https://cdn.example.com/live.m3u8"></div>', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "m3u8");
    assert.equal(assets[0].type, "VIDEO");
  });

  test("valor que não parece URL de vídeo nem http é ignorado", async () => {
    const assets = await extractMediaFromHtml('<div data-video="hello world"></div>', BASE);
    assert.equal(assets.length, 0);
  });
});

describe("extractMediaFromHtml - casos gerais", () => {
  test("HTML vazio retorna zero assets", async () => {
    const assets = await extractMediaFromHtml("", BASE);
    assert.deepEqual(assets, []);
  });

  test("HTML sem mídia retorna zero assets", async () => {
    const assets = await extractMediaFromHtml("<html><body><p>texto</p></body></html>", BASE);
    assert.deepEqual(assets, []);
  });

  test("respeita o limite maxAssets da config", async () => {
    const imgs = Array.from(
      { length: appConfig.limits.maxAssets + 10 },
      (_, i) => `<img src="https://cdn.example.com/img-${i}.jpg">`,
    ).join("");
    const assets = await extractMediaFromHtml(imgs, BASE);
    assert.equal(assets.length, appConfig.limits.maxAssets);
  });

  test("fileName é sanitizado (caracteres inválidos viram _)", async () => {
    const assets = await extractMediaFromHtml('<img src="https://cdn.example.com/meu%20arquivo%3F.jpg">', BASE);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].fileName.includes("?"), false);
  });
});

describe("extractMediaAndLinks - extração de links", () => {
  test("retorna assets e links juntos", async () => {
    const html = `
      <img src="https://cdn.example.com/pic.jpg">
      <a href="https://other.com/page">link</a>
    `;
    const result = await extractMediaAndLinks(html, BASE);
    assert.equal(result.assets.length, 1);
    assert.deepEqual(result.links, ["https://other.com/page"]);
  });

  test("remove fragmento dos links", async () => {
    const result = await extractMediaAndLinks('<a href="https://other.com/page#secao">x</a>', BASE);
    assert.deepEqual(result.links, ["https://other.com/page"]);
  });

  test("resolve links relativos contra a base", async () => {
    const result = await extractMediaAndLinks('<a href="/sobre">x</a>', BASE);
    assert.deepEqual(result.links, ["https://example.com/sobre"]);
  });

  test("ignora links javascript: e mailto:", async () => {
    const html = `
      <a href="javascript:void(0)">a</a>
      <a href="mailto:x@example.com">b</a>
      <a href="https://ok.com/">c</a>
    `;
    const result = await extractMediaAndLinks(html, BASE);
    assert.deepEqual(result.links, ["https://ok.com/"]);
  });

  test("deduplica links repetidos", async () => {
    const html = '<a href="https://dup.com/a">1</a><a href="https://dup.com/a">2</a>';
    const result = await extractMediaAndLinks(html, BASE);
    assert.deepEqual(result.links, ["https://dup.com/a"]);
  });

  test("a[href] de mídia aparece tanto como asset quanto como link", async () => {
    const result = await extractMediaAndLinks('<a href="https://cdn.example.com/m.mp4">v</a>', BASE);
    assert.equal(result.assets.length, 1);
    assert.deepEqual(result.links, ["https://cdn.example.com/m.mp4"]);
  });

  test("HTML vazio retorna listas vazias", async () => {
    const result = await extractMediaAndLinks("", BASE);
    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.links, []);
  });
});

describe("extractMediaAndLinksFromDom", () => {
  test("aceita um CheerioAPI pré-carregado e produz o mesmo resultado", async () => {
    const html = '<img src="https://cdn.example.com/pic.jpg"><a href="https://other.com/">x</a>';
    const $ = cheerio.load(html);
    const fromDom = await extractMediaAndLinksFromDom($, BASE);
    const fromHtml = await extractMediaAndLinks(html, BASE);
    assert.deepEqual(fromDom, fromHtml);
  });
});
