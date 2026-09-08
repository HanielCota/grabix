import assert from "node:assert/strict";
import { test } from "node:test";
import {
  crawlCompleteEventSchema,
  crawlConfigSchema,
  crawlErrorEventSchema,
  crawlResultSchema,
  crawlStartedEventSchema,
  deepCrawlRequestSchema,
  mediaFoundEventSchema,
  mediaItemSchema,
  pageCompleteEventSchema,
  pageDiscoveredEventSchema,
  pageErrorEventSchema,
  pageProcessingEventSchema,
  pageResultSchema,
  sseEventSchemas,
} from "../../src/lib/crawl/schemas.ts";

// ─── crawlConfigSchema ───

test("crawlConfigSchema aplica todos os defaults quando vazio", () => {
  const config = crawlConfigSchema.parse({});
  assert.deepEqual(config, {
    maxDepth: 2,
    maxPages: 20,
    maxConcurrent: 5,
    followSameDomain: true,
    followSubdomains: true,
    followVideoPlatforms: true,
    followExternal: false,
    requestTimeout: 10000,
    skipNavigationLinks: true,
  });
});

test("crawlConfigSchema aceita valores nos limites inclusive", () => {
  const config = crawlConfigSchema.parse({
    maxDepth: 1,
    maxPages: 1,
    maxConcurrent: 1,
    requestTimeout: 5000,
  });
  assert.equal(config.maxDepth, 1);
  assert.equal(config.requestTimeout, 5000);

  const upper = crawlConfigSchema.parse({ maxDepth: 3, maxPages: 50, maxConcurrent: 10, requestTimeout: 30000 });
  assert.equal(upper.maxPages, 50);
  assert.equal(upper.maxConcurrent, 10);
});

test("crawlConfigSchema rejeita valores fora dos limites", () => {
  assert.throws(() => crawlConfigSchema.parse({ maxDepth: 0 }));
  assert.throws(() => crawlConfigSchema.parse({ maxDepth: 4 }));
  assert.throws(() => crawlConfigSchema.parse({ maxPages: 0 }));
  assert.throws(() => crawlConfigSchema.parse({ maxPages: 51 }));
  assert.throws(() => crawlConfigSchema.parse({ maxConcurrent: 0 }));
  assert.throws(() => crawlConfigSchema.parse({ maxConcurrent: 11 }));
  assert.throws(() => crawlConfigSchema.parse({ requestTimeout: 4999 }));
  assert.throws(() => crawlConfigSchema.parse({ requestTimeout: 30001 }));
});

test("crawlConfigSchema rejeita números não-inteiros e tipos errados", () => {
  assert.throws(() => crawlConfigSchema.parse({ maxDepth: 1.5 }));
  assert.throws(() => crawlConfigSchema.parse({ maxPages: "20" }));
  assert.throws(() => crawlConfigSchema.parse({ followExternal: "yes" }));
});

// ─── deepCrawlRequestSchema ───

test("deepCrawlRequestSchema aceita URL pública e normaliza sem esquema", () => {
  const parsed = deepCrawlRequestSchema.parse({ url: "example.com/pagina" });
  assert.equal(parsed.url, "https://example.com/pagina");
  assert.equal(parsed.config, undefined);
});

test("deepCrawlRequestSchema aceita config parcial e aplica defaults", () => {
  const parsed = deepCrawlRequestSchema.parse({ url: "https://example.com", config: { maxDepth: 3 } });
  assert.equal(parsed.config?.maxDepth, 3);
  assert.equal(parsed.config?.maxPages, 20);
});

test("deepCrawlRequestSchema rejeita URL inválida, privada ou sem domínio", () => {
  assert.throws(() => deepCrawlRequestSchema.parse({ url: "not a url" }));
  assert.throws(() => deepCrawlRequestSchema.parse({ url: "http://127.0.0.1/" }));
  assert.throws(() => deepCrawlRequestSchema.parse({ url: "ftp://example.com" }));
  assert.throws(() => deepCrawlRequestSchema.parse({ url: "" }));
});

// ─── mediaItemSchema ───

function validMediaItem() {
  return {
    url: "https://example.com/video.mp4",
    type: "video",
    platform: "youtube",
    videoId: "abc",
    title: null,
    thumbnailUrl: "https://example.com/thumb.jpg",
    canonicalUrl: "https://www.youtube.com/watch?v=abc",
    contentKind: "video",
    confidence: 0.95,
    duration: null,
    source: "iframe",
    downloadable: false,
    discoveredFrom: "https://example.com/page",
    discoveryReason: "iframe-embed",
  };
}

test("mediaItemSchema aceita item válido completo", () => {
  const parsed = mediaItemSchema.parse(validMediaItem());
  assert.equal(parsed.type, "video");
  assert.equal(parsed.confidence, 0.95);
});

test("mediaItemSchema rejeita type inválido e confidence fora de [0,1]", () => {
  assert.throws(() => mediaItemSchema.parse({ ...validMediaItem(), type: "audio" }));
  assert.throws(() => mediaItemSchema.parse({ ...validMediaItem(), confidence: 1.1 }));
  assert.throws(() => mediaItemSchema.parse({ ...validMediaItem(), confidence: -0.1 }));
});

test("mediaItemSchema aceita confidence nula e contentKind nulo", () => {
  const parsed = mediaItemSchema.parse({ ...validMediaItem(), confidence: null, contentKind: null });
  assert.equal(parsed.confidence, null);
});

test("mediaItemSchema rejeita source vazia e URL privada", () => {
  assert.throws(() => mediaItemSchema.parse({ ...validMediaItem(), source: "" }));
  assert.throws(() => mediaItemSchema.parse({ ...validMediaItem(), url: "http://192.168.0.1/v.mp4" }));
});

// ─── pageResultSchema / crawlResultSchema ───

function validPageResult() {
  return {
    url: "https://example.com/page",
    depth: 0,
    title: "Título",
    media: [validMediaItem()],
    error: null,
    possibleSpa: false,
    pageKind: "hub",
    discoveredFrom: null,
    discoveryReason: null,
  };
}

test("pageResultSchema aceita página válida e todos os pageKinds", () => {
  assert.equal(pageResultSchema.parse(validPageResult()).pageKind, "hub");
  for (const pageKind of ["landing", "hub", "listing", "media", "platform", "unknown"]) {
    assert.equal(pageResultSchema.parse({ ...validPageResult(), pageKind }).pageKind, pageKind);
  }
});

test("pageResultSchema rejeita depth negativo, não-inteiro e pageKind inválido", () => {
  assert.throws(() => pageResultSchema.parse({ ...validPageResult(), depth: -1 }));
  assert.throws(() => pageResultSchema.parse({ ...validPageResult(), depth: 0.5 }));
  assert.throws(() => pageResultSchema.parse({ ...validPageResult(), pageKind: "blog" }));
});

test("crawlResultSchema valida resultado agregado", () => {
  const result = {
    originalUrl: "https://example.com",
    pagesCrawled: 3,
    pagesWithErrors: 1,
    totalMedia: 5,
    results: [validPageResult()],
    crawlDurationMs: 1234.5,
  };
  const parsed = crawlResultSchema.parse(result);
  assert.equal(parsed.pagesCrawled, 3);
});

test("crawlResultSchema rejeita contagens negativas e não-inteiras", () => {
  const base = {
    originalUrl: "https://example.com",
    pagesCrawled: 0,
    pagesWithErrors: 0,
    totalMedia: 0,
    results: [],
    crawlDurationMs: 0,
  };
  assert.throws(() => crawlResultSchema.parse({ ...base, pagesCrawled: -1 }));
  assert.throws(() => crawlResultSchema.parse({ ...base, totalMedia: 1.5 }));
  assert.throws(() => crawlResultSchema.parse({ ...base, crawlDurationMs: -0.1 }));
  // duração fracionária é permitida (só exige >= 0)
  assert.equal(crawlResultSchema.parse({ ...base, crawlDurationMs: 0.5 }).crawlDurationMs, 0.5);
});

// ─── Eventos SSE ───

test("crawlStartedEventSchema exige config completa", () => {
  const parsed = crawlStartedEventSchema.parse({
    url: "https://example.com",
    config: crawlConfigSchema.parse({}),
  });
  assert.equal(parsed.config.maxDepth, 2);

  // Como todos os campos de config têm default, {} é preenchido automaticamente
  const withDefaults = crawlStartedEventSchema.parse({ url: "https://example.com", config: {} });
  assert.equal(withDefaults.config.maxDepth, 2);

  // Mas valores inválidos dentro da config continuam sendo rejeitados
  assert.throws(() => crawlStartedEventSchema.parse({ url: "https://example.com", config: { maxDepth: 99 } }));
  assert.throws(() => crawlStartedEventSchema.parse({ url: "https://example.com" }));
});

test("pageDiscoveredEventSchema valida categoria e source", () => {
  const event = {
    url: "https://example.com/a",
    category: "same_domain",
    depth: 1,
    source: "anchor",
    fromUrl: "https://example.com",
    discoveryReason: null,
  };
  assert.equal(pageDiscoveredEventSchema.parse(event).category, "same_domain");
  assert.throws(() => pageDiscoveredEventSchema.parse({ ...event, category: "interna" }));
  assert.throws(() => pageDiscoveredEventSchema.parse({ ...event, source: "clique" }));
});

test("pageProcessingEventSchema valida contadores", () => {
  const event = { url: "https://example.com/a", depth: 0, pagesDone: 1, pagesTotal: 10 };
  assert.equal(pageProcessingEventSchema.parse(event).pagesTotal, 10);
  assert.throws(() => pageProcessingEventSchema.parse({ ...event, pagesDone: -1 }));
});

test("mediaFoundEventSchema embute um mediaItem válido", () => {
  const parsed = mediaFoundEventSchema.parse({
    pageUrl: "https://example.com/page",
    media: validMediaItem(),
  });
  assert.equal(parsed.media.type, "video");
  assert.throws(() => mediaFoundEventSchema.parse({ pageUrl: "https://example.com", media: {} }));
});

test("pageCompleteEventSchema e pageErrorEventSchema validam payloads", () => {
  assert.equal(pageCompleteEventSchema.parse({ url: "https://example.com/a", mediaCount: 3, depth: 1 }).mediaCount, 3);
  assert.throws(() => pageCompleteEventSchema.parse({ url: "https://example.com/a", mediaCount: -1, depth: 1 }));

  assert.equal(
    pageErrorEventSchema.parse({ url: "https://example.com/a", error: "timeout", depth: 0 }).error,
    "timeout",
  );
  assert.throws(() => pageErrorEventSchema.parse({ url: "https://example.com/a", error: "", depth: 0 }));
});

test("crawlCompleteEventSchema e crawlErrorEventSchema validam payloads", () => {
  const complete = {
    originalUrl: "https://example.com",
    totalPages: 2,
    pagesWithErrors: 0,
    totalMedia: 4,
    results: [validPageResult()],
    crawlDurationMs: 500,
  };
  assert.equal(crawlCompleteEventSchema.parse(complete).totalMedia, 4);
  assert.throws(() => crawlCompleteEventSchema.parse({ ...complete, totalPages: -1 }));

  assert.equal(crawlErrorEventSchema.parse({ error: "falha geral" }).error, "falha geral");
  assert.throws(() => crawlErrorEventSchema.parse({ error: "" }));
});

test("sseEventSchemas expõe exatamente os 8 eventos esperados", () => {
  assert.deepEqual(Object.keys(sseEventSchemas).sort(), [
    "crawl_complete",
    "crawl_error",
    "crawl_started",
    "media_found",
    "page_complete",
    "page_discovered",
    "page_error",
    "page_processing",
  ]);
});
