import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  getTweetId,
  parseTweetResult,
  syndicationToken,
} from "../../src/features/media-downloader/infrastructure/twitter-extractor.ts";

const TWEET_ID = "1600009574919962625";

// ─── getTweetId: URLs válidas ───

describe("getTweetId - formatos válidos", () => {
  const valid: [url: string, expected: string][] = [
    ["https://twitter.com/user/status/123", "123"],
    ["https://x.com/user/status/123", "123"],
    ["http://twitter.com/user/status/123", "123"],
    ["http://x.com/user/status/123", "123"],
    ["https://www.twitter.com/user/status/123", "123"],
    ["https://www.x.com/user/status/123", "123"],
    ["https://mobile.twitter.com/user/status/123", "123"],
    ["https://m.twitter.com/user/status/123", "123"],
    ["https://m.x.com/user/status/123", "123"],
    ["https://amp.twitter.com/user/status/123", "123"],
    ["https://twitter.com/user/statuses/123", "123"],
    ["https://x.com/i/web/status/123", "123"],
    ["https://twitter.com/user/status/123/", "123"],
    ["https://twitter.com/user/status/123/photo/1", "123"],
    ["https://twitter.com/user/status/123/photo/2", "123"],
    ["https://twitter.com/user/status/123/video/1", "123"],
    ["https://twitter.com/user/status/123?s=20&t=abc123", "123"],
    ["https://x.com/user/status/123?utm_source=share", "123"],
    ["https://x.com/user/status/123#reply", "123"],
    ["https://twitter.com/us_er123/status/123", "123"],
    ["https://twitter.com/user/Status/123", "123"],
    ["https://twitter.com/user/STATUS/123", "123"],
    ["https://TWITTER.COM/user/status/123", "123"],
    ["https://X.COM/user/status/123", "123"],
    ["https://x.com/whatever/status/1600009574919962625", "1600009574919962625"],
    ["https://x.com/u/status/0042", "0042"],
    ["https://x.com/u/status/9999999999999999999999999", "9999999999999999999999999"],
    ["https://twitter.com:443/user/status/123", "123"],
  ];

  for (const [url, expected] of valid) {
    test(`extrai "${expected}" de ${url}`, () => {
      assert.equal(getTweetId(url), expected);
    });
  }
});

// ─── getTweetId: URLs inválidas ───

describe("getTweetId - formatos inválidos", () => {
  const invalid = [
    "https://twitter.com/home",
    "https://twitter.com/explore",
    "https://twitter.com/notifications",
    "https://x.com/user",
    "https://x.com/user/",
    "https://x.com/user/status",
    "https://x.com/user/status/",
    "https://x.com/user/status/abc",
    "https://x.com/user/status/123abc",
    "https://x.com/user/status/abc123",
    "https://nottwitter.com/user/status/123",
    "https://xtwitter.com/user/status/123",
    "https://twitter.com.evil.com/user/status/123",
    "https://x.com.evil.com/user/status/123",
    "https://evil-twitter.com/user/status/123",
    "https://example.com/user/status/123",
    "https://example.com/twitter.com/user/status/123",
    "ftp://twitter.com/user/status/123",
    "file:///twitter.com/user/status/123",
    "twitter.com/user/status/123",
    "//twitter.com/user/status/123",
    "www.twitter.com/user/status/123",
    "",
    "   ",
    "not a url",
    "123",
    "https://twitter.com",
    "https://x.com",
    "https://twitter.com/",
  ];

  for (const url of invalid) {
    test(`retorna null para "${url}"`, () => {
      assert.equal(getTweetId(url), null);
    });
  }
});

// ─── syndicationToken ───

describe("syndicationToken", () => {
  test("é determinístico", () => {
    assert.equal(syndicationToken(TWEET_ID), syndicationToken(TWEET_ID));
    assert.equal(syndicationToken("20"), syndicationToken("20"));
  });

  test("só contém caracteres base36 sem zeros nem ponto", () => {
    for (const id of ["20", "123", "665052190608723968", TWEET_ID, "9999999999999999999999999"]) {
      assert.match(syndicationToken(id), /^[1-9a-z]+$/, `token do id ${id}`);
    }
  });

  test("snapshots estáveis (o servidor depende do algoritmo exato)", () => {
    assert.equal(syndicationToken("20"), "6dq1a2xwd93");
    assert.equal(syndicationToken("123"), "138spvehogpo");
    assert.equal(syndicationToken("665052190608723968"), "1m1bmpg2m2t");
    assert.equal(syndicationToken("1600009574919962625"), "3vmktiebrx");
  });

  test("ids distintos geram tokens distintos", () => {
    const tokens = new Set(["20", "123", "456", "665052190608723968", TWEET_ID].map(syndicationToken));
    assert.equal(tokens.size, 5);
  });

  test("aceita ids maiores que Number.MAX_SAFE_INTEGER sem explodir", () => {
    const token = syndicationToken("9999999999999999999999999");
    assert.equal(typeof token, "string");
    assert.ok(token.length > 0);
  });
});

// ─── parseTweetResult: vídeos ───

describe("parseTweetResult - vídeos", () => {
  test("escolhe a variante mp4 de maior bitrate, ignorando m3u8", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "video",
          media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg",
          video_info: {
            variants: [
              {
                content_type: "application/x-mpegURL",
                url: "https://video.twimg.com/ext_tw_video/1/pu/pl/x.m3u8?tag=12",
              },
              {
                bitrate: 256000,
                content_type: "video/mp4",
                url: "https://video.twimg.com/ext_tw_video/1/pu/vid/480x270/a.mp4?tag=12",
              },
              {
                bitrate: 2176000,
                content_type: "video/mp4",
                url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/b.mp4?tag=12",
              },
              {
                bitrate: 832000,
                content_type: "video/mp4",
                url: "https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/c.mp4?tag=12",
              },
            ],
          },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/b.mp4?tag=12");
    assert.equal(assets[0].type, "VIDEO");
    assert.equal(assets[0].extension, "mp4");
    assert.equal(assets[0].fileName, `twitter-${TWEET_ID}-video-1.mp4`);
    assert.equal(assets[0].sourceTag, "twitter[syndication]");
  });

  test("variante mp4 única é usada mesmo sem bitrate", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "video",
          video_info: {
            variants: [{ content_type: "video/mp4", url: "https://video.twimg.com/v/only.mp4" }],
          },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://video.twimg.com/v/only.mp4");
  });

  test("variante sem URL é ignorada", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "video",
          video_info: {
            variants: [
              { bitrate: 999999, content_type: "video/mp4" },
              { bitrate: 1, content_type: "video/mp4", url: "https://video.twimg.com/v/ok.mp4" },
            ],
          },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://video.twimg.com/v/ok.mp4");
  });

  test("cai para HLS quando não há mp4 (application/x-mpegURL)", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "video",
          video_info: {
            variants: [{ content_type: "application/x-mpegURL", url: "https://video.twimg.com/pl/x.m3u8?tag=12" }],
          },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "m3u8");
    assert.equal(assets[0].type, "VIDEO");
    assert.equal(assets[0].fileName, `twitter-${TWEET_ID}-video-1.m3u8`);
  });

  test("cai para HLS com MIME application/vnd.apple.mpegurl", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "video",
          video_info: {
            variants: [{ content_type: "application/vnd.apple.mpegurl", url: "https://video.twimg.com/pl/y.m3u8" }],
          },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "m3u8");
  });

  test("MIME de HLS em caixa alta também é reconhecido", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "video",
          video_info: {
            variants: [{ content_type: "APPLICATION/X-MPEGURL", url: "https://video.twimg.com/pl/z.m3u8" }],
          },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "m3u8");
  });

  test("vídeo sem nenhuma variante utilizável não gera asset", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        { type: "video", video_info: { variants: [] } },
        { type: "video" },
        { type: "video", video_info: null },
        { type: "video", video_info: { variants: [{ content_type: "video/mp4" }] } },
      ],
    };

    assert.deepEqual(parseTweetResult(data, TWEET_ID), []);
  });

  test("URL de vídeo sem extensão cai no fallback mp4", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "video",
          video_info: { variants: [{ content_type: "video/mp4", url: "https://video.twimg.com/v/abcDEF" }] },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].extension, "mp4");
    assert.equal(assets[0].fileName, `twitter-${TWEET_ID}-video-1.mp4`);
  });

  test("numera múltiplos vídeos em sequência preservando a ordem", () => {
    const video = (id: number, url: string) => ({
      type: "video",
      video_info: { variants: [{ bitrate: 1000 * id, content_type: "video/mp4", url }] },
    });
    const data = {
      __typename: "Tweet",
      mediaDetails: [video(1, "https://video.twimg.com/v/1.mp4"), video(2, "https://video.twimg.com/v/2.mp4")],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 2);
    assert.equal(assets[0].fileName, `twitter-${TWEET_ID}-video-1.mp4`);
    assert.equal(assets[1].fileName, `twitter-${TWEET_ID}-video-2.mp4`);
  });

  test("mesma URL de vídeo em dois mediaDetails gera um único asset", () => {
    const entry = {
      type: "video",
      video_info: { variants: [{ content_type: "video/mp4", url: "https://video.twimg.com/v/dup.mp4" }] },
    };
    const data = { __typename: "Tweet", mediaDetails: [entry, entry] };

    assert.equal(parseTweetResult(data, TWEET_ID).length, 1);
  });
});

// ─── parseTweetResult: GIFs ───

describe("parseTweetResult - GIFs (animated_gif)", () => {
  test("animated_gif vira mp4 baixável com nome gif", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "animated_gif",
          media_url_https: "https://pbs.twimg.com/tweet_video_thumb/abc.jpg",
          video_info: {
            variants: [{ bitrate: 0, content_type: "video/mp4", url: "https://video.twimg.com/tweet_video/abc.mp4" }],
          },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].type, "VIDEO");
    assert.equal(assets[0].extension, "mp4");
    assert.equal(assets[0].fileName, `twitter-${TWEET_ID}-gif-1.mp4`);
  });

  test("contadores de gif e vídeo são independentes", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "animated_gif",
          video_info: { variants: [{ content_type: "video/mp4", url: "https://video.twimg.com/tweet_video/g.mp4" }] },
        },
        {
          type: "video",
          video_info: { variants: [{ content_type: "video/mp4", url: "https://video.twimg.com/v/v.mp4" }] },
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 2);
    assert.equal(assets[0].fileName, `twitter-${TWEET_ID}-gif-1.mp4`);
    assert.equal(assets[1].fileName, `twitter-${TWEET_ID}-video-1.mp4`);
  });
});

// ─── parseTweetResult: fotos ───

describe("parseTweetResult - fotos", () => {
  test("coleta fotos de mediaDetails e do array photos, sem duplicar", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/AAA.jpg" },
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/BBB.png" },
      ],
      photos: [{ url: "https://pbs.twimg.com/media/AAA.jpg" }, { url: "https://pbs.twimg.com/media/CCC.jpg" }],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.deepEqual(
      assets.map((a) => a.url),
      [
        "https://pbs.twimg.com/media/AAA.jpg",
        "https://pbs.twimg.com/media/BBB.png",
        "https://pbs.twimg.com/media/CCC.jpg",
      ],
    );
    assert.ok(assets.every((a) => a.type === "IMAGE"));
    assert.equal(assets[0].fileName, `twitter-${TWEET_ID}-photo-1.jpg`);
    assert.equal(assets[1].fileName, `twitter-${TWEET_ID}-photo-2.png`);
    assert.equal(assets[2].fileName, `twitter-${TWEET_ID}-photo-3.jpg`);
  });

  test("extensão vem da URL quando presente (webp)", () => {
    const data = {
      __typename: "Tweet",
      photos: [{ url: "https://pbs.twimg.com/media/XYZ.webp" }],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets[0].extension, "webp");
  });

  test("foto sem extensão na URL cai no fallback jpg", () => {
    const data = {
      __typename: "Tweet",
      photos: [{ url: "https://pbs.twimg.com/media/XYZ?format=png&name=small" }],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets[0].extension, "jpg");
  });

  test("foto com URL inválida ou não-string é ignorada", () => {
    const data = {
      __typename: "Tweet",
      photos: [{ url: "" }, { url: 123 }, {}, { url: null }, { url: "https://pbs.twimg.com/media/ok.jpg" }],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://pbs.twimg.com/media/ok.jpg");
  });
});

// ─── parseTweetResult: payloads inválidos / defensivo ───

describe("parseTweetResult - payloads inválidos", () => {
  test("retorna [] para tombstones e tweets indisponíveis", () => {
    assert.deepEqual(parseTweetResult({ __typename: "TweetTombstone", tombstone: {} }, TWEET_ID), []);
    assert.deepEqual(parseTweetResult({ __typename: "TweetUnavailable" }, TWEET_ID), []);
  });

  test("retorna [] quando __typename não é Tweet", () => {
    assert.deepEqual(parseTweetResult({}, TWEET_ID), []);
    assert.deepEqual(parseTweetResult({ __typename: "User" }, TWEET_ID), []);
    assert.deepEqual(parseTweetResult({ __typename: "tweet" }, TWEET_ID), []);
  });

  test("retorna [] para dados que nem objeto são", () => {
    assert.deepEqual(parseTweetResult(null, TWEET_ID), []);
    assert.deepEqual(parseTweetResult(undefined, TWEET_ID), []);
    assert.deepEqual(parseTweetResult("garbage", TWEET_ID), []);
    assert.deepEqual(parseTweetResult(42, TWEET_ID), []);
    assert.deepEqual(parseTweetResult(true, TWEET_ID), []);
    assert.deepEqual(parseTweetResult([], TWEET_ID), []);
  });

  test("tweet sem mídia retorna []", () => {
    assert.deepEqual(parseTweetResult({ __typename: "Tweet", text: "just setting up my twttr" }, TWEET_ID), []);
    assert.deepEqual(parseTweetResult({ __typename: "Tweet", mediaDetails: [], photos: [] }, TWEET_ID), []);
  });

  test("mediaDetails que não é array não quebra o parser", () => {
    assert.deepEqual(parseTweetResult({ __typename: "Tweet", mediaDetails: 123 }, TWEET_ID), []);
    assert.deepEqual(parseTweetResult({ __typename: "Tweet", mediaDetails: {} }, TWEET_ID), []);
    assert.deepEqual(parseTweetResult({ __typename: "Tweet", mediaDetails: null }, TWEET_ID), []);
    assert.deepEqual(parseTweetResult({ __typename: "Tweet", mediaDetails: "abc" }, TWEET_ID), []);
  });

  test("photos que não é array não quebra o parser", () => {
    assert.deepEqual(parseTweetResult({ __typename: "Tweet", photos: 42 }, TWEET_ID), []);
    assert.deepEqual(parseTweetResult({ __typename: "Tweet", photos: "x" }, TWEET_ID), []);
  });

  test("entradas null/estranhas dentro de mediaDetails são ignoradas", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        null,
        undefined,
        "garbage",
        42,
        {
          type: "photo",
          media_url_https: "https://pbs.twimg.com/media/ok.jpg",
        },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, "https://pbs.twimg.com/media/ok.jpg");
  });

  test("variants que não é array não quebra o parser", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [{ type: "video", video_info: { variants: 123 } }],
    };

    assert.deepEqual(parseTweetResult(data, TWEET_ID), []);
  });

  test("tipos de mídia desconhecidos são ignorados", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        { type: "card", media_url_https: "https://pbs.twimg.com/card/1.jpg" },
        { type: "audio_space", media_url_https: "https://pbs.twimg.com/audio/1.jpg" },
        { type: "moment", media_url_https: "https://pbs.twimg.com/moment/1.jpg" },
      ],
    };

    assert.deepEqual(parseTweetResult(data, TWEET_ID), []);
  });
});

// ─── parseTweetResult: cenário completo ───

describe("parseTweetResult - cenário completo", () => {
  test("tweet com vídeo + fotos mantém ordem e shape de MediaAsset", () => {
    const data = {
      __typename: "Tweet",
      mediaDetails: [
        {
          type: "video",
          media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/thumb.jpg",
          video_info: {
            variants: [
              { bitrate: 100, content_type: "video/mp4", url: "https://video.twimg.com/v/low.mp4" },
              { bitrate: 200, content_type: "video/mp4", url: "https://video.twimg.com/v/high.mp4" },
            ],
          },
        },
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/P.jpg" },
      ],
    };

    const assets = parseTweetResult(data, TWEET_ID);
    assert.equal(assets.length, 2);
    assert.deepEqual(Object.keys(assets[0]).sort(), ["extension", "fileName", "sourceTag", "type", "url"]);
    assert.equal(assets[0].url, "https://video.twimg.com/v/high.mp4");
    assert.equal(assets[1].url, "https://pbs.twimg.com/media/P.jpg");
    assert.ok(assets.every((a) => a.sourceTag === "twitter[syndication]"));
    assert.ok(assets.every((a) => a.fileName.startsWith(`twitter-${TWEET_ID}-`)));
  });
});
