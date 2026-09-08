import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "cheerio";
import { discoverEmbeds } from "../../src/lib/crawl/embed-discovery.ts";

const BASE = "https://example.com/page";

function discover(html: string, baseUrl = BASE) {
  return discoverEmbeds(load(html), baseUrl);
}

// ─── iframes ───

test("iframe com embed do YouTube gera mídia de plataforma", () => {
  const results = discover(`<iframe src="https://www.youtube.com/embed/abc123"></iframe>`);
  assert.equal(results.length, 1);
  const media = results[0];
  assert.equal(media.type, "video");
  assert.equal(media.platform, "youtube");
  assert.equal(media.videoId, "abc123");
  assert.equal(media.canonicalUrl, "https://www.youtube.com/watch?v=abc123");
  assert.equal(media.source, "iframe");
  assert.equal(media.discoveryReason, "iframe-embed");
  assert.equal(media.downloadable, false);
});

test("iframe usa data-src e data-lazy-src como fallback", () => {
  const dataSrc = discover(`<iframe data-src="https://vimeo.com/123456"></iframe>`);
  assert.equal(dataSrc.length, 1);
  assert.equal(dataSrc[0].platform, "vimeo");

  const lazy = discover(`<iframe data-lazy-src="https://vimeo.com/654321"></iframe>`);
  assert.equal(lazy.length, 1);
  assert.equal(lazy[0].videoId, "654321");
});

test("iframe com vídeo direto (.mp4) é marcado como baixável", () => {
  const results = discover(`<iframe src="https://cdn.example.com/video.mp4"></iframe>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "direct");
  assert.equal(results[0].downloadable, true);
  assert.equal(results[0].discoveryReason, "direct-iframe");
});

test("iframe sem vídeo é ignorado", () => {
  assert.deepEqual(discover(`<iframe src="https://example.com/form"></iframe>`), []);
  assert.deepEqual(discover(`<iframe></iframe>`), []);
});

// ─── <video> ───

test("tag video com src e poster: vídeo com thumbnail + imagem do poster", () => {
  const results = discover(`<video poster="/poster.jpg" src="/media/clip.mp4"></video>`);
  assert.equal(results.length, 2);

  const video = results.find((r) => r.type === "video");
  assert.ok(video);
  assert.equal(video.url, "https://example.com/media/clip.mp4");
  assert.equal(video.thumbnailUrl, "https://example.com/poster.jpg");
  assert.equal(video.source, "video_tag");
  assert.equal(video.discoveryReason, "html5-video");
  assert.equal(video.downloadable, true);

  const poster = results.find((r) => r.type === "image");
  assert.ok(poster);
  assert.equal(poster.url, "https://example.com/poster.jpg");
  assert.equal(poster.discoveryReason, "video-poster");
});

test("tag video com elementos <source> extrai cada um", () => {
  const results = discover(`
    <video><source src="/a.webm"><source data-src="/a.mp4"></video>
  `);
  const videos = results.filter((r) => r.type === "video");
  assert.equal(videos.length, 2);
  assert.deepEqual(videos.map((v) => v.url).sort(), ["https://example.com/a.mp4", "https://example.com/a.webm"]);
  assert.ok(videos.every((v) => v.discoveryReason === "html5-video-source"));
});

// ─── embed / object ───

test("embed[src] e object[data] são extraídos com a fonte correta", () => {
  const results = discover(`
    <embed src="https://www.youtube.com/embed/abc">
    <object data="https://cdn.example.com/movie.mp4"></object>
  `);
  assert.equal(results.length, 2);
  const fromEmbed = results.find((r) => r.platform === "youtube");
  const fromObject = results.find((r) => r.platform === "direct");
  assert.equal(fromEmbed?.source, "embed_tag");
  assert.equal(fromEmbed?.discoveryReason, "object-embed");
  assert.equal(fromObject?.source, "object_tag");
  assert.equal(fromObject?.discoveryReason, "direct-embed");
});

// ─── Elementor ───

test("widget de vídeo do Elementor extrai youtube_url do data-settings", () => {
  const html = `<div class="elementor-widget-video" data-settings="{&quot;youtube_url&quot;:&quot;https://www.youtube.com/watch?v=el1&quot;}"></div>`;
  const results = discover(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "youtube");
  assert.equal(results[0].videoId, "el1");
  assert.equal(results[0].source, "data_attr");
  assert.equal(results[0].discoveryReason, "elementor-video-widget");
  assert.ok(results[0].confidence >= 0.94);
});

test("widget Elementor com data-settings inválido é ignorado", () => {
  assert.deepEqual(discover(`<div class="elementor-widget-video" data-settings="{quebrado"></div>`), []);
});

// ─── Players leves (lite-youtube, amp-*) ───

test("lite-youtube e amp-youtube geram mídia do YouTube pelo videoid", () => {
  const lite = discover(`<lite-youtube videoid="abc123"></lite-youtube>`);
  assert.equal(lite.length, 1);
  assert.equal(lite[0].platform, "youtube");
  assert.equal(lite[0].videoId, "abc123");
  assert.equal(lite[0].discoveryReason, "light-youtube-player");
  assert.ok(lite[0].confidence >= 0.92);

  const amp = discover(`<amp-youtube data-videoid="xyz789"></amp-youtube>`);
  assert.equal(amp.length, 1);
  assert.equal(amp[0].videoId, "xyz789");
});

test("amp-vimeo gera mídia do Vimeo pelo data-videoid", () => {
  const results = discover(`<amp-vimeo data-videoid="12345"></amp-vimeo>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "vimeo");
  assert.equal(results[0].canonicalUrl, "https://vimeo.com/12345");
  assert.equal(results[0].discoveryReason, "light-vimeo-player");
});

// ─── data attributes genéricos ───

test("data-video-src com URL direta gera vídeo baixável", () => {
  const results = discover(`<div data-video-src="https://cdn.example.com/direct.mp4"></div>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "direct");
  assert.equal(results[0].source, "data_attr");
  assert.equal(results[0].discoveryReason, "media-attribute");
});

test("data-video-id é interpretado como ID do YouTube", () => {
  const results = discover(`<div data-video-id="ytid123"></div>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "youtube");
  assert.equal(results[0].videoId, "ytid123");
  assert.equal(results[0].discoveryReason, "youtube-id-attribute");
});

// ─── Meta tags ───

test("og:video e og:image são extraídos", () => {
  const results = discover(`
    <meta property="og:video" content="https://www.youtube.com/watch?v=abc">
    <meta property="og:image" content="https://example.com/cover.jpg">
  `);
  assert.equal(results.length, 2);
  const video = results.find((r) => r.type === "video");
  const image = results.find((r) => r.type === "image");
  assert.equal(video?.platform, "youtube");
  assert.equal(video?.source, "og_meta");
  assert.equal(video?.discoveryReason, "og-video");
  assert.equal(image?.url, "https://example.com/cover.jpg");
  assert.equal(image?.discoveryReason, "og-image");
  assert.equal(image?.platform, null);
});

test("twitter:player é extraído como twitter_meta", () => {
  const results = discover(`<meta name="twitter:player" content="https://www.youtube.com/embed/tw1">`);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "youtube");
  assert.equal(results[0].source, "twitter_meta");
  assert.equal(results[0].discoveryReason, "twitter-card");
});

// ─── JSON-LD ───

test("JSON-LD VideoObject extrai contentUrl, embedUrl e thumbnailUrl", () => {
  const jsonLd = JSON.stringify({
    "@type": "VideoObject",
    contentUrl: "https://cdn.example.com/v.mp4",
    embedUrl: "https://www.youtube.com/embed/xyz",
    thumbnailUrl: "https://example.com/thumb.jpg",
  });
  const results = discover(`<script type="application/ld+json">${jsonLd}</script>`);
  assert.equal(results.length, 3);

  const direct = results.find((r) => r.url === "https://cdn.example.com/v.mp4");
  assert.equal(direct?.platform, "direct");
  assert.equal(direct?.source, "json_ld");
  assert.equal(direct?.discoveryReason, "json-ld-video");

  const yt = results.find((r) => r.platform === "youtube");
  assert.ok(yt);
  assert.ok(yt.confidence >= 0.96);

  const thumb = results.find((r) => r.type === "image");
  assert.equal(thumb?.url, "https://example.com/thumb.jpg");
  assert.equal(thumb?.discoveryReason, "json-ld-thumbnail");
});

test("JSON-LD em @graph e em array raiz são percorridos", () => {
  const graph = JSON.stringify({
    "@graph": [{ "@type": "VideoObject", contentUrl: "https://cdn.example.com/g.mp4" }],
  });
  const viaGraph = discover(`<script type="application/ld+json">${graph}</script>`);
  assert.equal(viaGraph.length, 1);

  const array = JSON.stringify([{ "@type": "VideoObject", contentUrl: "https://cdn.example.com/a.mp4" }]);
  const viaArray = discover(`<script type="application/ld+json">${array}</script>`);
  assert.equal(viaArray.length, 1);
});

test("JSON-LD malformado ou de tipo não-vídeo é ignorado", () => {
  assert.deepEqual(discover(`<script type="application/ld+json">{invalido</script>`), []);
  assert.deepEqual(
    discover(`<script type="application/ld+json">{"@type":"Article","url":"https://example.com/a"}</script>`),
    [],
  );
});

// ─── Scripts inline ───

test("script inline com estado estruturado (dica + URL de plataforma) é extraído", () => {
  const results = discover(
    `<script>window.__NEXT_DATA__ = {"props":{"youtube_url":"https://www.youtube.com/watch?v=nx1"}};</script>`,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "youtube");
  assert.equal(results[0].videoId, "nx1");
  assert.equal(results[0].source, "inline_script");
  assert.equal(results[0].discoveryReason, "structured-player-state");
  assert.ok(results[0].confidence >= 0.82);
});

test("script inline sem palavra-chave de estrutura não é varrido para plataformas", () => {
  // Sem hint (__NEXT_DATA__, youtube_url, etc.) o extrator estruturado ignora o script.
  const results = discover(`<script>var u = "https://www.youtube.com/watch?v=abc";</script>`);
  assert.deepEqual(results, []);
});

test("script inline com URL de vídeo direta é extraído sem precisar de dica", () => {
  const results = discover(`<script>var src = "https://cdn.example.com/stream.m3u8";</script>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "direct");
  assert.equal(results[0].source, "inline_script");
  assert.equal(results[0].discoveryReason, "inline-direct-video");
  assert.equal(results[0].downloadable, true);
});

test("script[src] de player VTurb é reconhecido", () => {
  const results = discover(`<script src="https://scripts.converteai.net/conta1/players/player9/player.js"></script>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, "vturb");
  assert.equal(results[0].videoId, "player9");
  assert.equal(results[0].discoveryReason, "vturb-player-script");
});

test("script[src] comum não gera mídia", () => {
  assert.deepEqual(discover(`<script src="https://example.com/app.js"></script>`), []);
});

// ─── Deduplicação e página vazia ───

test("o mesmo vídeo encontrado por fontes diferentes é deduplicado pela URL canônica", () => {
  const results = discover(`
    <iframe src="https://www.youtube.com/embed/abc"></iframe>
    <meta property="og:video" content="https://www.youtube.com/watch?v=abc">
  `);
  assert.equal(results.length, 1);
  assert.equal(results[0].source, "iframe");
});

test("página sem mídia retorna lista vazia", () => {
  assert.deepEqual(discover("<p>Texto puro</p>"), []);
});
