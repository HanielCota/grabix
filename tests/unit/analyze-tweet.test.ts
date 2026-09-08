import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mergeAssetsDeduped } from "../../src/features/media-downloader/application/analyze-page.ts";
import type { MediaAsset } from "../../src/features/media-downloader/domain/types.ts";

function asset(url: string, overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    url,
    type: "VIDEO",
    fileName: "file.mp4",
    extension: "mp4",
    sourceTag: "test",
    ...overrides,
  };
}

describe("mergeAssetsDeduped", () => {
  test("concatena as fontes em ordem", () => {
    const a = [asset("https://a.com/1.mp4"), asset("https://a.com/2.mp4")];
    const b = [asset("https://b.com/1.mp4")];

    const merged = mergeAssetsDeduped([a, b], 10);
    assert.deepEqual(
      merged.map((m) => m.url),
      ["https://a.com/1.mp4", "https://a.com/2.mp4", "https://b.com/1.mp4"],
    );
  });

  test("primeira ocorrência de uma URL vence entre fontes", () => {
    const fromTwitter = asset("https://dup.com/v.mp4", { sourceTag: "twitter[syndication]" });
    const fromHtml = asset("https://dup.com/v.mp4", { sourceTag: "img[src]" });

    const merged = mergeAssetsDeduped([[fromTwitter], [fromHtml]], 10);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].sourceTag, "twitter[syndication]");
  });

  test("deduplica também dentro da mesma fonte", () => {
    const source = [asset("https://a.com/1.mp4"), asset("https://a.com/1.mp4")];
    assert.equal(mergeAssetsDeduped([source], 10).length, 1);
  });

  test("tolera fontes null", () => {
    const merged = mergeAssetsDeduped([null, [asset("https://a.com/1.mp4")], null], 10);
    assert.equal(merged.length, 1);
  });

  test("sem fontes ou tudo vazio retorna []", () => {
    assert.deepEqual(mergeAssetsDeduped([], 10), []);
    assert.deepEqual(mergeAssetsDeduped([null, []], 10), []);
  });

  test("respeita o limite max", () => {
    const source = [asset("https://a.com/1.mp4"), asset("https://a.com/2.mp4"), asset("https://a.com/3.mp4")];

    const merged = mergeAssetsDeduped([source], 2);
    assert.deepEqual(
      merged.map((m) => m.url),
      ["https://a.com/1.mp4", "https://a.com/2.mp4"],
    );
  });

  test("max 0 ou negativo retorna []", () => {
    const source = [asset("https://a.com/1.mp4")];
    assert.deepEqual(mergeAssetsDeduped([source], 0), []);
    assert.deepEqual(mergeAssetsDeduped([source], -5), []);
  });

  test("max maior que o total retorna tudo", () => {
    const source = [asset("https://a.com/1.mp4"), asset("https://a.com/2.mp4")];
    assert.equal(mergeAssetsDeduped([source], 100).length, 2);
  });

  test("o limite é aplicado depois da deduplicação", () => {
    const source = [
      asset("https://a.com/1.mp4"),
      asset("https://a.com/1.mp4"),
      asset("https://a.com/2.mp4"),
      asset("https://a.com/3.mp4"),
    ];

    // 3 URLs únicas; max 2 deve pegar as duas primeiras únicas.
    const merged = mergeAssetsDeduped([source], 2);
    assert.deepEqual(
      merged.map((m) => m.url),
      ["https://a.com/1.mp4", "https://a.com/2.mp4"],
    );
  });

  test("não muta os arrays de entrada", () => {
    const a = [asset("https://a.com/1.mp4")];
    const b = [asset("https://b.com/1.mp4")];
    mergeAssetsDeduped([a, b], 10);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });

  test("URLs que diferem só por query string são assets distintos", () => {
    const source = [asset("https://a.com/v.mp4?tag=12"), asset("https://a.com/v.mp4?tag=14")];
    assert.equal(mergeAssetsDeduped([source], 10).length, 2);
  });
});
