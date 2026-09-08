import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractVideoInfo,
  identifyPlatform,
  isVideoPlatformDomain,
  isVideoPlatformUrl,
} from "../../src/lib/crawl/platform-registry.ts";

// ─── YouTube ───

test("youtube: extrai videoId de watch?v=", () => {
  const info = extractVideoInfo("https://www.youtube.com/watch?v=abc123XYZ_-");
  assert.ok(info);
  assert.equal(info.platform, "youtube");
  assert.equal(info.videoId, "abc123XYZ_-");
  assert.equal(info.kind, "video");
  assert.equal(info.canonicalUrl, "https://www.youtube.com/watch?v=abc123XYZ_-");
  assert.equal(info.thumbnailUrl, "https://img.youtube.com/vi/abc123XYZ_-/mqdefault.jpg");
  assert.equal(info.confidence, 0.98);
});

test("youtube: youtu.be curto gera URL canônica de watch", () => {
  const info = extractVideoInfo("https://youtu.be/dQw4w9WgXcQ?t=42");
  assert.ok(info);
  assert.equal(info.videoId, "dQw4w9WgXcQ");
  assert.equal(info.canonicalUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(info.confidence, 0.99);
});

test("youtube: youtu.be sem id retorna null", () => {
  assert.equal(extractVideoInfo("https://youtu.be/"), null);
});

test("youtube: shorts, live e clip têm kinds próprios", () => {
  const shorts = extractVideoInfo("https://www.youtube.com/shorts/xyz123");
  assert.equal(shorts?.kind, "short");
  assert.equal(shorts?.canonicalUrl, "https://www.youtube.com/shorts/xyz123");

  const live = extractVideoInfo("https://www.youtube.com/live/liveId9");
  assert.equal(live?.kind, "live");
  assert.equal(live?.canonicalUrl, "https://www.youtube.com/live/liveId9");

  const clip = extractVideoInfo("https://www.youtube.com/clip/Ugkx123");
  assert.equal(clip?.kind, "clip");
  assert.equal(clip?.thumbnailUrl, null);
});

test("youtube: embed converte para watch canônico", () => {
  const info = extractVideoInfo("https://www.youtube.com/embed/vid123?autoplay=1");
  assert.ok(info);
  assert.equal(info.kind, "video");
  assert.equal(info.canonicalUrl, "https://www.youtube.com/watch?v=vid123");
  assert.equal(info.confidence, 0.97);
});

test("youtube: playlist identificada por list em /playlist ou /watch", () => {
  const info = extractVideoInfo("https://www.youtube.com/playlist?list=PLabc123");
  assert.ok(info);
  assert.equal(info.kind, "playlist");
  assert.equal(info.videoId, "PLabc123");
  assert.equal(info.canonicalUrl, "https://www.youtube.com/playlist?list=PLabc123");
  assert.equal(info.confidence, 0.88);

  // watch com v e list: o parâmetro v tem precedência
  const watch = extractVideoInfo("https://www.youtube.com/watch?v=vid1&list=PLabc123");
  assert.equal(watch?.kind, "video");
  assert.equal(watch?.videoId, "vid1");
});

test("youtube: canais @handle e /channel/ são reconhecidos", () => {
  const handle = extractVideoInfo("https://www.youtube.com/@CanalExemplo");
  assert.ok(handle);
  assert.equal(handle.kind, "channel");
  assert.equal(handle.videoId, "@CanalExemplo");
  assert.equal(handle.canonicalUrl, "https://www.youtube.com/@CanalExemplo");

  const channel = extractVideoInfo("https://www.youtube.com/channel/UCxxxxxxxx");
  assert.equal(channel?.kind, "channel");
  assert.equal(channel?.videoId, "UCxxxxxxxx");
});

test("youtube: hosts alternativos (m., music., nocookie) funcionam", () => {
  assert.equal(extractVideoInfo("https://m.youtube.com/watch?v=abc")?.videoId, "abc");
  assert.equal(extractVideoInfo("https://music.youtube.com/watch?v=abc")?.videoId, "abc");
  assert.equal(extractVideoInfo("https://www.youtube-nocookie.com/embed/abc")?.videoId, "abc");
});

test("youtube: páginas sem vídeo retornam null", () => {
  assert.equal(extractVideoInfo("https://www.youtube.com/"), null);
  assert.equal(extractVideoInfo("https://www.youtube.com/watch"), null);
  assert.equal(extractVideoInfo("https://www.youtube.com/feed/subscriptions"), null);
  assert.equal(extractVideoInfo("https://foo.youtube.com/watch?v=abc"), null);
});

// ─── Vimeo ───

test("vimeo: URL numérica direta e player.vimeo.com/video/", () => {
  const direct = extractVideoInfo("https://vimeo.com/123456789");
  assert.ok(direct);
  assert.equal(direct.platform, "vimeo");
  assert.equal(direct.videoId, "123456789");
  assert.equal(direct.thumbnailUrl, "https://vumbnail.com/123456789.jpg");
  assert.equal(direct.confidence, 0.96);

  const player = extractVideoInfo("https://player.vimeo.com/video/987654321?h=abc");
  assert.ok(player);
  assert.equal(player.videoId, "987654321");
  assert.equal(player.canonicalUrl, "https://vimeo.com/987654321");
  assert.equal(player.confidence, 0.97);
});

test("vimeo: path não numérico retorna null", () => {
  assert.equal(extractVideoInfo("https://vimeo.com/categories/animation"), null);
  assert.equal(extractVideoInfo("https://player.vimeo.com/video/"), null);
});

// ─── Dailymotion ───

test("dailymotion: /video/id_titulo corta no underscore", () => {
  const info = extractVideoInfo("https://www.dailymotion.com/video/x7tgad0_titulo-do-video");
  assert.ok(info);
  assert.equal(info.platform, "dailymotion");
  assert.equal(info.videoId, "x7tgad0");
  assert.equal(info.canonicalUrl, "https://www.dailymotion.com/video/x7tgad0");
  assert.equal(info.thumbnailUrl, "https://www.dailymotion.com/thumbnail/video/x7tgad0");
});

test("dailymotion: dai.ly curto", () => {
  const info = extractVideoInfo("https://dai.ly/x7tgad0");
  assert.ok(info);
  assert.equal(info.videoId, "x7tgad0");
  assert.equal(info.confidence, 0.96);
});

test("dailymotion: paths fora do padrão retornam null", () => {
  assert.equal(extractVideoInfo("https://www.dailymotion.com/"), null);
  assert.equal(extractVideoInfo("https://dai.ly/"), null);
});

// ─── Twitch ───

test("twitch: /videos/id e clips.twitch.tv", () => {
  const vod = extractVideoInfo("https://www.twitch.tv/videos/1234567890");
  assert.ok(vod);
  assert.equal(vod.platform, "twitch");
  assert.equal(vod.kind, "video");
  assert.equal(vod.videoId, "1234567890");

  const clip = extractVideoInfo("https://clips.twitch.tv/SomeClipName");
  assert.ok(clip);
  assert.equal(clip.kind, "clip");
  assert.equal(clip.canonicalUrl, "https://clips.twitch.tv/SomeClipName");
});

test("twitch: página de canal não é vídeo", () => {
  assert.equal(extractVideoInfo("https://www.twitch.tv/somechannel"), null);
});

// ─── Twitter/X, TikTok, Instagram ───

test("twitter: /status/<digits> em twitter.com e x.com", () => {
  const tw = extractVideoInfo("https://twitter.com/user/status/1234567890123");
  assert.ok(tw);
  assert.equal(tw.platform, "twitter");
  assert.equal(tw.videoId, "1234567890123");
  assert.equal(tw.canonicalUrl, "https://twitter.com/user/status/1234567890123");

  const x = extractVideoInfo("https://x.com/user/status/999/");
  assert.ok(x);
  assert.equal(x.videoId, "999");
  assert.equal(x.canonicalUrl, "https://x.com/user/status/999");

  assert.equal(extractVideoInfo("https://twitter.com/user"), null);
});

test("tiktok: /video/<digits>", () => {
  const info = extractVideoInfo("https://www.tiktok.com/@user/video/7250000000000000000");
  assert.ok(info);
  assert.equal(info.platform, "tiktok");
  assert.equal(info.videoId, "7250000000000000000");
  assert.equal(info.confidence, 0.94);

  assert.equal(extractVideoInfo("https://www.tiktok.com/@user"), null);
});

test("instagram: /reel/ e /p/", () => {
  const reel = extractVideoInfo("https://www.instagram.com/reel/Cxyz123abc/");
  assert.ok(reel);
  assert.equal(reel.platform, "instagram");
  assert.equal(reel.videoId, "Cxyz123abc");

  const post = extractVideoInfo("https://www.instagram.com/p/Cxyz123abc");
  assert.ok(post);
  assert.equal(post.videoId, "Cxyz123abc");
  assert.ok(post.canonicalUrl.endsWith("/"));

  assert.equal(extractVideoInfo("https://www.instagram.com/userprofile/"), null);
});

// ─── Holodex, Bilibili, Niconico ───

test("holodex: watch, channel e multiview", () => {
  const watch = extractVideoInfo("https://holodex.net/watch/abc123");
  assert.equal(watch?.platform, "holodex");
  assert.equal(watch?.kind, "video");

  const channel = extractVideoInfo("https://holodex.net/channel/UCxyz");
  assert.equal(channel?.kind, "channel");

  const multiview = extractVideoInfo("https://holodex.net/multiview/AAVMabc123");
  assert.equal(multiview?.kind, "playlist");
  assert.equal(multiview?.confidence, 0.84);

  assert.equal(extractVideoInfo("https://holodex.net/"), null);
});

test("bilibili: /video/BV e b23.tv curto", () => {
  const video = extractVideoInfo("https://www.bilibili.com/video/BV1xx411c7mD");
  assert.ok(video);
  assert.equal(video.platform, "bilibili");
  assert.equal(video.videoId, "BV1xx411c7mD");

  const short = extractVideoInfo("https://b23.tv/abc123");
  assert.ok(short);
  assert.equal(short.kind, "video");
  assert.equal(short.confidence, 0.88);

  assert.equal(extractVideoInfo("https://www.bilibili.com/"), null);
});

test("niconico: /watch/id é sombreado pelo matcher do holodex (bug conhecido)", () => {
  // BUG (comportamento real documentado): os matchers de holodex, twitter, tiktok,
  // instagram e niconico NÃO verificam o hostname — apenas o path. Como holodex vem
  // antes de niconico na lista de plataformas, qualquer URL /watch/<id> (incluindo
  // nicovideo.jp) é classificada como holodex, tornando o matcher do niconico
  // inalcançável para seu próprio domínio.
  const info = extractVideoInfo("https://www.nicovideo.jp/watch/sm12345678");
  assert.ok(info);
  assert.equal(info.platform, "holodex");
  assert.equal(info.videoId, "sm12345678");
  assert.equal(info.canonicalUrl, "https://holodex.net/watch/sm12345678");

  assert.equal(extractVideoInfo("https://www.nicovideo.jp/tag/exemplo"), null);
});

test("matchers baseados em path ignoram o hostname (bug conhecido)", () => {
  // Comportamento real: paths típicos de twitter/tiktok/instagram/holodex em
  // domínios arbitrários são classificados como se fossem dessas plataformas.
  assert.equal(extractVideoInfo("https://example.com/user/status/123")?.platform, "twitter");
  assert.equal(extractVideoInfo("https://example.com/video/12345")?.platform, "tiktok");
  assert.equal(extractVideoInfo("https://example.com/reel/abc123")?.platform, "instagram");
  assert.equal(extractVideoInfo("https://example.com/p/abc123")?.platform, "instagram");
  assert.equal(extractVideoInfo("https://example.com/watch/xyz")?.platform, "holodex");
  assert.equal(extractVideoInfo("https://example.com/channel/xyz")?.platform, "holodex");
  assert.equal(extractVideoInfo("https://example.com/multiview/xyz")?.platform, "holodex");
});

// ─── VTurb / ConverteAI ───

test("vturb: script de player em scripts.converteai.net", () => {
  const embed = extractVideoInfo("https://scripts.converteai.net/conta123/players/player456/embed.html");
  assert.ok(embed);
  assert.equal(embed.platform, "vturb");
  assert.equal(embed.videoId, "player456");
  assert.equal(embed.canonicalUrl, "https://scripts.converteai.net/conta123/players/player456/embed.html");
  assert.equal(embed.confidence, 0.95);

  // player.js reduz a confiança para 0.9
  const playerJs = extractVideoInfo("https://scripts.converteai.net/conta123/players/player456/player.js");
  assert.equal(playerJs?.confidence, 0.9);

  // caminho v4 com segmento extra também funciona
  const v4 = extractVideoInfo("https://player.converteai.net/conta123/players/player456/v4/embed.html");
  assert.ok(v4);
  assert.equal(v4.videoId, "player456");
});

test("vturb: ab-test é reconhecido com confiança menor", () => {
  const url = "https://scripts.converteai.net/conta123/ab-test/teste789/player.js";
  const info = extractVideoInfo(url);
  assert.ok(info);
  assert.equal(info.videoId, "teste789");
  assert.equal(info.confidence, 0.78);
  assert.equal(info.canonicalUrl, url);
});

test("vturb: CDN só reconhece URLs com extensão de vídeo", () => {
  const hls = extractVideoInfo("https://cdn.converteai.net/hash123/video.m3u8");
  assert.ok(hls);
  assert.equal(hls.platform, "vturb");
  assert.equal(hls.videoId, "hash123");
  assert.equal(hls.confidence, 0.96);

  const mp4 = extractVideoInfo("https://cdn.vturb.com.br/abc/video.mp4?token=x");
  assert.ok(mp4);

  assert.equal(extractVideoInfo("https://cdn.converteai.net/hash123/thumb.jpg"), null);
  assert.equal(extractVideoInfo("https://cdn.converteai.net/"), null);
});

test("vturb: host de script sem path de players retorna null", () => {
  assert.equal(extractVideoInfo("https://scripts.converteai.net/conta123/outra-coisa/x"), null);
});

// ─── Funções de nível superior ───

test("extractVideoInfo aceita URLs protocol-relative e retorna null para lixo", () => {
  const info = extractVideoInfo("//www.youtube.com/watch?v=abc123");
  assert.ok(info);
  assert.equal(info.videoId, "abc123");

  assert.equal(extractVideoInfo("not a url"), null);
  assert.equal(extractVideoInfo(""), null);
  // Sem esquema e sem "//", o parser não consegue montar URL
  assert.equal(extractVideoInfo("youtube.com/watch?v=abc"), null);
});

test("extractVideoInfo retorna null para sites fora das plataformas", () => {
  assert.equal(extractVideoInfo("https://example.com/video.mp4"), null);
  assert.equal(extractVideoInfo("https://vimeo.com.evil.com/123"), null);
});

test("isVideoPlatformUrl reflete extractVideoInfo", () => {
  assert.equal(isVideoPlatformUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isVideoPlatformUrl("https://www.youtube.com/"), false);
  assert.equal(isVideoPlatformUrl("https://example.com/"), false);
  assert.equal(isVideoPlatformUrl("lixo"), false);
});

test("isVideoPlatformDomain checa apenas o domínio, mesmo sem vídeo no path", () => {
  assert.equal(isVideoPlatformDomain("https://www.youtube.com/"), true);
  assert.equal(isVideoPlatformDomain("https://youtu.be/"), true);
  assert.equal(isVideoPlatformDomain("https://images.converteai.net/qualquer"), true);
  assert.equal(isVideoPlatformDomain("https://example.com/"), false);
  assert.equal(isVideoPlatformDomain("not a url"), false);
});

test("identifyPlatform retorna a plataforma correspondente ou null", () => {
  assert.equal(identifyPlatform("https://www.youtube.com/watch?v=abc")?.name, "youtube");
  assert.equal(identifyPlatform("https://vimeo.com/123")?.name, "vimeo");
  assert.equal(identifyPlatform("https://www.youtube.com/"), null);
  assert.equal(identifyPlatform("lixo"), null);
});
