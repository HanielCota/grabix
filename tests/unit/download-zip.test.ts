import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, mock, test } from "node:test";
import type { MediaAsset } from "../../src/features/media-downloader/domain/types.ts";
import { appConfig } from "../../src/server/config.ts";

// createZipStream usa archiver + safeFetch (undici + DNS reais). Os testes
// profundos mockam "undici" e "node:dns/promises" via mock.module, que só
// existe com --experimental-test-module-mocks; sem a flag eles são pulados
// (skip), seguindo a convenção de tests/unit/safe-fetch.test.ts. As validações
// e os caminhos que falham antes da rede rodam sempre.

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP_NET = "requer node --experimental-test-module-mocks para mockar undici/DNS";

// extensão propositalmente inválida (não-mídia) para os testes de descarte
const INVALID_EXT = "txt" as MediaAsset["extension"];

type FetchInit = { headers?: Record<string, string>; signal?: AbortSignal };
type FetchImpl = (url: string, init: FetchInit) => Promise<Response>;

let fetchImpl: FetchImpl = async () => new Response("ok");

if (canMockModules) {
  mock.module("undici", {
    namedExports: {
      Agent: class Agent {},
      fetch: (url: string, init: FetchInit) => fetchImpl(url, init),
    },
  });
  mock.module("node:dns/promises", {
    namedExports: {
      lookup: (_hostname: string, _opts?: unknown) => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    },
  });
}

async function importZip() {
  return import("../../src/features/media-downloader/application/download-zip.ts");
}

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    url: "https://cdn.example.com/a.mp4",
    type: "VIDEO",
    fileName: "a.mp4",
    extension: "mp4",
    sourceTag: "test",
    ...overrides,
  };
}

async function consume(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function videoResponse(body: string, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "video/mp4", ...headers } });
}

describe("createZipStream - validações síncronas", () => {
  test("rejeita lista vazia", async () => {
    const { createZipStream } = await importZip();
    await assert.rejects(
      () => createZipStream([]),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "DOWNLOAD_FAILED");
        assert.match(err.message, /Nenhum arquivo selecionado/);
        return true;
      },
    );
  });

  test("rejeita null/undefined", async () => {
    const { createZipStream } = await importZip();
    // biome-ignore lint/suspicious/noExplicitAny: testando robustez contra entrada inválida
    await assert.rejects(() => createZipStream(null as any), /Nenhum arquivo selecionado/);
    // biome-ignore lint/suspicious/noExplicitAny: testando robustez contra entrada inválida
    await assert.rejects(() => createZipStream(undefined as any), /Nenhum arquivo selecionado/);
  });

  test("rejeita quando ultrapassa o limite maxAssets", async () => {
    const { createZipStream } = await importZip();
    const tooMany = Array.from({ length: appConfig.limits.maxAssets + 1 }, (_, i) =>
      asset({ url: `https://cdn.example.com/${i}.mp4`, fileName: `${i}.mp4` }),
    );
    await assert.rejects(
      () => createZipStream(tooMany),
      (err: Error & { code?: string }) => err.code === "TOO_MANY_ASSETS",
    );
  });

  test("aceita exatamente maxAssets (passa na validação de contagem)", async () => {
    const { createZipStream } = await importZip();
    const exact = Array.from({ length: appConfig.limits.maxAssets }, (_, i) =>
      asset({ url: `http://localhost/${i}.txt`, fileName: `${i}.txt`, extension: INVALID_EXT }),
    );
    // Extensão inválida -> nenhum asset chega ao fetch -> erro via stream, não na criação.
    const stream = await createZipStream(exact);
    assert.ok(stream instanceof Readable);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });
});

describe("createZipStream - assets que falham antes/durante o fetch", () => {
  test("retorna um Readable (o erro chega pelo stream, não pela promise)", async () => {
    const { createZipStream } = await importZip();
    const stream = await createZipStream([asset({ extension: INVALID_EXT, fileName: "a.txt" })]);
    assert.ok(stream instanceof Readable);
    await assert.rejects(() => consume(stream));
  });

  test("extensão inválida é descartada antes do fetch e o stream falha com DOWNLOAD_FAILED", async () => {
    const { createZipStream } = await importZip();
    const stream = await createZipStream([asset({ extension: INVALID_EXT, fileName: "a.txt" })]);
    await assert.rejects(
      () => consume(stream),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "DOWNLOAD_FAILED");
        assert.match(err.message, /Nenhum arquivo pôde ser baixado/);
        return true;
      },
    );
  });

  test("asset sem url é descartado", async () => {
    const { createZipStream } = await importZip();
    // biome-ignore lint/suspicious/noExplicitAny: asset propositalmente incompleto
    const stream = await createZipStream([asset({ url: undefined as any })]);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });

  test("asset sem extension é descartado", async () => {
    const { createZipStream } = await importZip();
    // biome-ignore lint/suspicious/noExplicitAny: asset propositalmente incompleto
    const stream = await createZipStream([asset({ extension: undefined as any })]);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });

  test("asset sem fileName é descartado", async () => {
    const { createZipStream } = await importZip();
    // biome-ignore lint/suspicious/noExplicitAny: asset propositalmente incompleto
    const stream = await createZipStream([asset({ fileName: undefined as any })]);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });

  test("asset null na lista é descartado", async () => {
    const { createZipStream } = await importZip();
    // biome-ignore lint/suspicious/noExplicitAny: entrada propositalmente inválida
    const stream = await createZipStream([null as any]);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });

  test("fetch barrado pelo SSRF guard retorna null e o stream falha", async () => {
    const { createZipStream } = await importZip();
    const stream = await createZipStream([asset({ url: "http://localhost/a.mp4" })]);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });

  test("URL malformada no asset retorna null e o stream falha", async () => {
    const { createZipStream } = await importZip();
    const stream = await createZipStream([asset({ url: "https://" })]);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });
});

describe("createZipStream - abort", () => {
  test("signal já abortado faz o stream falhar com CLIENT_ABORTED", async () => {
    const { createZipStream } = await importZip();
    const controller = new AbortController();
    controller.abort();
    const stream = await createZipStream([asset()], controller.signal);
    await assert.rejects(() => consume(stream), /CLIENT_ABORTED/);
  });

  test("abort antes do primeiro batch tem precedência sobre assets inválidos", async () => {
    const { createZipStream } = await importZip();
    const controller = new AbortController();
    controller.abort();
    const stream = await createZipStream([asset({ extension: INVALID_EXT })], controller.signal);
    await assert.rejects(() => consume(stream), /CLIENT_ABORTED/);
  });
});

describe("createZipStream - opções", () => {
  test("respeita concurrency customizado (processa em batches menores)", async () => {
    const { createZipStream } = await importZip();
    const assets = [1, 2, 3].map((i) => asset({ extension: INVALID_EXT, fileName: `${i}.txt` }));
    const stream = await createZipStream(assets, undefined, { concurrency: 1 });
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });

  test("maxZipBytes customizado é aceito sem alterar as validações", async () => {
    const { createZipStream } = await importZip();
    const stream = await createZipStream([asset({ extension: INVALID_EXT })], undefined, { maxZipBytes: 1024 });
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });
});

describe("createZipStream - montagem do ZIP com fetch/DNS mockados", () => {
  test("gera um ZIP válido (magic PK) contendo o asset", { skip: !canMockModules && SKIP_NET }, async () => {
    const { createZipStream } = await importZip();
    fetchImpl = async () => videoResponse("conteudo-do-video");
    const stream = await createZipStream([asset()]);
    const zip = await consume(stream);
    assert.ok(zip.length > 0);
    assert.equal(zip.subarray(0, 2).toString(), "PK");
    // nomes das entradas aparecem em texto puro nos headers do ZIP
    assert.ok(zip.includes("a.mp4"));
  });

  test("resolve colisão de nomes com sufixo -2", { skip: !canMockModules && SKIP_NET }, async () => {
    const { createZipStream } = await importZip();
    fetchImpl = async () => videoResponse("x");
    const assets = [
      asset({ url: "https://cdn.example.com/1.mp4", fileName: "a.mp4" }),
      asset({ url: "https://cdn.example.com/2.mp4", fileName: "a.mp4" }),
    ];
    const zip = await consume(await createZipStream(assets));
    assert.ok(zip.includes("a.mp4"));
    assert.ok(zip.includes("a-2.mp4"));
  });

  test("sanitiza nomes de arquivo perigosos", { skip: !canMockModules && SKIP_NET }, async () => {
    const { createZipStream } = await importZip();
    fetchImpl = async () => videoResponse("x");
    const zip = await consume(await createZipStream([asset({ fileName: "../../etc/passwd.mp4" })]));
    // sanitizeFileName troca / por _ - não pode haver path traversal no ZIP
    assert.equal(zip.includes("../"), false);
    assert.ok(zip.includes("passwd.mp4"));
  });

  test("asset com falha individual é pulado e o ZIP leva só os que funcionaram", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { createZipStream } = await importZip();
    fetchImpl = async (url) => {
      if (url.includes("quebrado")) return videoResponse("no", {}, 500);
      return videoResponse("ok");
    };
    const assets = [
      asset({ url: "https://cdn.example.com/quebrado.mp4", fileName: "quebrado.mp4" }),
      asset({ url: "https://cdn.example.com/bom.mp4", fileName: "bom.mp4" }),
    ];
    const zip = await consume(await createZipStream(assets));
    assert.ok(zip.includes("bom.mp4"));
    assert.equal(zip.includes("quebrado.mp4"), false);
  });

  test("asset com content-type inválido é pulado", { skip: !canMockModules && SKIP_NET }, async () => {
    const { createZipStream } = await importZip();
    fetchImpl = async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    const stream = await createZipStream([asset()]);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });

  test("asset com content-length acima do limite é pulado antes de ler o corpo", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { createZipStream } = await importZip();
    fetchImpl = async () => videoResponse("x", { "content-length": String(appConfig.limits.maxFileSizeBytes + 1) });
    const stream = await createZipStream([asset()]);
    await assert.rejects(() => consume(stream), /Nenhum arquivo pôde ser baixado/);
  });

  test("content-length não-numérico não derruba o asset (cai no guarda do stream)", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { createZipStream } = await importZip();
    fetchImpl = async () => videoResponse("dados", { "content-length": "abc" });
    const zip = await consume(await createZipStream([asset()]));
    assert.ok(zip.includes("a.mp4"));
  });

  test("estouro de maxZipBytes falha o stream com ZIP_TOO_LARGE", { skip: true }, () => {
    // BUG em src/features/media-downloader/application/download-zip.ts (withZipLimit):
    // quando o limite de tamanho do ZIP estoura, o Transform limiter emite 'error'
    // sem nenhum listener (o archiver não encaminha erros do stream de entrada).
    // Resultado: o erro vira uncaughtException no processo e o passThrough nunca
    // é destruído - o consumidor fica pendurado, sem 'error' nem 'end'.
    // O teste ideal (consume() rejeita com ZIP_TOO_LARGE) é impossível hoje: o
    // uncaughtException derruba o próprio test runner. Verificado manualmente
    // com uma reprodução isolada (ZipArchive + Transform idênticos ao código).
  });

  test("abort no meio do processamento falha o stream com CLIENT_ABORTED", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { createZipStream } = await importZip();
    const controller = new AbortController();
    fetchImpl = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    const stream = await createZipStream([asset()], controller.signal);
    const consumed = consume(stream);
    controller.abort();
    await assert.rejects(() => consumed, /CLIENT_ABORTED/);
  });
});
