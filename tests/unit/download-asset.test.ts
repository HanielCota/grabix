import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// downloadAsset usa safeFetch (undici + DNS reais). Os testes profundos mockam
// "undici" e "node:dns/promises" via mock.module, que só existe com
// --experimental-test-module-mocks; sem a flag eles são pulados (skip), seguindo
// a convenção de tests/unit/safe-fetch.test.ts. Os testes de validação (antes
// de qualquer rede) rodam sempre.

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP_NET = "requer node --experimental-test-module-mocks para mockar undici/DNS";

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

async function importDownloader() {
  return import("../../src/features/media-downloader/application/download-asset.ts");
}

function mediaResponse(body: string | null, headers: Record<string, string>, status = 200): Response {
  return new Response(body, { status, headers });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

describe("downloadAsset - validação de URL", () => {
  test("rejeita URL vazia", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset(""),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /vazia/);
        return true;
      },
    );
  });

  test("rejeita URL só com espaços", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(() => downloadAsset("   "), /vazia/);
  });

  test("rejeita null/undefined", async () => {
    const { downloadAsset } = await importDownloader();
    // biome-ignore lint/suspicious/noExplicitAny: testando robustez contra entrada inválida
    await assert.rejects(() => downloadAsset(null as any), /vazia/);
    // biome-ignore lint/suspicious/noExplicitAny: testando robustez contra entrada inválida
    await assert.rejects(() => downloadAsset(undefined as any), /vazia/);
  });
});

describe("downloadAsset - validação de extensão", () => {
  test("rejeita extensão que não é de mídia (.exe)", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/setup.exe"),
      (err: Error & { code?: string }) => err.code === "INVALID_MEDIA_TYPE",
    );
  });

  test("rejeita .txt e .pdf", async () => {
    const { downloadAsset } = await importDownloader();
    for (const ext of ["txt", "pdf"]) {
      await assert.rejects(
        () => downloadAsset(`https://cdn.example.com/doc.${ext}`),
        (err: Error & { code?: string }) => err.code === "INVALID_MEDIA_TYPE",
      );
    }
  });

  test("rejeita extensão não-mídia mesmo em maiúsculas", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/SETUP.EXE"),
      (err: Error & { code?: string }) => err.code === "INVALID_MEDIA_TYPE",
    );
  });

  test("a validação de extensão acontece antes de qualquer fetch (host privado com .exe dá INVALID_MEDIA_TYPE, não SSRF)", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("http://localhost/setup.exe"),
      (err: Error & { code?: string }) => err.code === "INVALID_MEDIA_TYPE",
    );
  });
});

describe("downloadAsset - propagação de AppError do safeFetch (sem rede)", () => {
  test("host privado propaga SSRF_BLOCKED sem reembrulhar", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("http://localhost/video.mp4"),
      (err: Error & { code?: string; statusCode?: number }) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "SSRF_BLOCKED");
        assert.equal(err.statusCode, 403);
        return true;
      },
    );
  });

  test("IP privado propaga SSRF_BLOCKED", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("http://192.168.0.10/foto.jpg"),
      (err: Error & { code?: string }) => err.code === "SSRF_BLOCKED",
    );
  });

  test("URL sem extensão passa pela validação de extensão e falha no SSRF guard", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("http://localhost/stream"),
      (err: Error & { code?: string }) => err.code === "SSRF_BLOCKED",
    );
  });

  test("URL malformada propaga INVALID_URL", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("https://"),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /malformada/);
        return true;
      },
    );
  });

  test("esquema não-HTTP com extensão de mídia propaga INVALID_URL", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("ftp://example.com/video.mp4"),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "INVALID_URL");
        assert.match(err.message, /HTTP e HTTPS/);
        return true;
      },
    );
  });

  test("extensão de mídia via query string passa pela validação e chega ao safeFetch", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("http://localhost/download?file=clip.mp4"),
      (err: Error & { code?: string }) => err.code === "SSRF_BLOCKED",
    );
  });

  test("aceita maxBytes customizado sem alterar a validação prévia", async () => {
    const { downloadAsset } = await importDownloader();
    await assert.rejects(
      () => downloadAsset("http://localhost/video.mp4", undefined, 1024),
      (err: Error & { code?: string }) => err.code === "SSRF_BLOCKED",
    );
  });
});

describe("downloadAsset - fluxo completo com fetch/DNS mockados", () => {
  test("200 com mídia retorna stream, contentType, contentLength e fileName da URL", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("dados-do-video", { "content-type": "video/mp4", "content-length": "14" });
    const result = await downloadAsset("https://cdn.example.com/clip.mp4");
    assert.equal(result.contentType, "video/mp4");
    assert.equal(result.contentLength, 14);
    assert.equal(result.fileName, "clip.mp4");
    assert.equal((await readStream(result.stream)).toString(), "dados-do-video");
  });

  test("content-length não-numérico vira contentLength null (não vaza NaN)", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("abc", { "content-type": "video/mp4", "content-length": "abc" });
    const result = await downloadAsset("https://cdn.example.com/clip.mp4");
    assert.equal(result.contentLength, null);
    assert.equal((await readStream(result.stream)).toString(), "abc");
  });

  test("content-length ausente vira contentLength null", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("abc", { "content-type": "image/png" });
    const result = await downloadAsset("https://cdn.example.com/foto.png");
    assert.equal(result.contentLength, null);
    assert.equal(result.contentType, "image/png");
  });

  test("application/octet-stream é aceito como content-type", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("bin", { "content-type": "application/octet-stream" });
    const result = await downloadAsset("https://cdn.example.com/stream");
    assert.equal(result.contentType, "application/octet-stream");
  });

  test("status não-OK lança DOWNLOAD_FAILED com o status", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("not found", { "content-type": "text/html" }, 404);
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/clip.mp4"),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "DOWNLOAD_FAILED");
        assert.match(err.message, /Status HTTP 404/);
        return true;
      },
    );
  });

  test("content-type não-mídia lança INVALID_MEDIA_TYPE", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("<html></html>", { "content-type": "text/html" });
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/clip.mp4"),
      (err: Error & { code?: string }) => err.code === "INVALID_MEDIA_TYPE",
    );
  });

  test("content-type ausente lança INVALID_MEDIA_TYPE", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => new Response("abc", { status: 200 });
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/clip.mp4"),
      (err: Error & { code?: string }) => err.code === "INVALID_MEDIA_TYPE",
    );
  });

  test("content-length acima de maxBytes lança FILE_TOO_LARGE antes de ler o corpo", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("x".repeat(1000), { "content-type": "video/mp4", "content-length": "1000" });
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/clip.mp4", undefined, 100),
      (err: Error & { code?: string }) => err.code === "FILE_TOO_LARGE",
    );
  });

  test("stream que ultrapassa maxBytes durante a leitura falha com FILE_TOO_LARGE", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { downloadAsset } = await importDownloader();
    // sem content-length: o guarda do stream é a única defesa
    fetchImpl = async () => mediaResponse("x".repeat(1000), { "content-type": "video/mp4" });
    const result = await downloadAsset("https://cdn.example.com/clip.mp4", undefined, 100);
    await assert.rejects(() => readStream(result.stream), /FILE_TOO_LARGE/);
  });

  test("stream dentro de maxBytes lê até o fim sem erro", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("x".repeat(100), { "content-type": "video/mp4" });
    const result = await downloadAsset("https://cdn.example.com/clip.mp4", undefined, 100);
    assert.equal((await readStream(result.stream)).length, 100);
  });

  test("resposta sem corpo lança DOWNLOAD_FAILED", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse(null, { "content-type": "video/mp4" });
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/clip.mp4"),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "DOWNLOAD_FAILED");
        assert.match(err.message, /sem corpo/);
        return true;
      },
    );
  });

  test("timeout do safeFetch vira DOWNLOAD_FAILED 'Timeout.'", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    };
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/clip.mp4"),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "DOWNLOAD_FAILED");
        assert.match(err.message, /Timeout/);
        return true;
      },
    );
  });

  test("erro genérico de rede vira DOWNLOAD_FAILED 'Erro de rede.'", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => {
      throw new Error("boom");
    };
    await assert.rejects(
      () => downloadAsset("https://cdn.example.com/clip.mp4"),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "DOWNLOAD_FAILED");
        assert.match(err.message, /Erro de rede/);
        return true;
      },
    );
  });
});

describe("downloadAsset - nome do arquivo via Content-Disposition", () => {
  test("filename quoted tem prioridade sobre o nome da URL", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () =>
      mediaResponse("abc", {
        "content-type": "video/mp4",
        "content-disposition": 'attachment; filename="filme legal.mp4"',
      });
    const result = await downloadAsset("https://cdn.example.com/stream");
    assert.equal(result.fileName, "filme legal.mp4");
  });

  test("filename sem aspas também é lido", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () =>
      mediaResponse("abc", {
        "content-type": "video/mp4",
        "content-disposition": "attachment; filename=clip.mp4",
      });
    const result = await downloadAsset("https://cdn.example.com/stream");
    assert.equal(result.fileName, "clip.mp4");
  });

  test("filename vazio no header cai no fallback da URL", { skip: !canMockModules && SKIP_NET }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () =>
      mediaResponse("abc", {
        "content-type": "video/mp4",
        "content-disposition": 'attachment; filename=""',
      });
    const result = await downloadAsset("https://cdn.example.com/clip.mp4");
    assert.equal(result.fileName, "clip.mp4");
  });

  test("URL extensionless sem disposition gera fileName media-N.bin (extensão não vem do content-type)", {
    skip: !canMockModules && SKIP_NET,
  }, async () => {
    const { downloadAsset } = await importDownloader();
    fetchImpl = async () => mediaResponse("abc", { "content-type": "video/mp4" });
    const result = await downloadAsset("https://cdn.example.com/stream");
    assert.equal(result.fileName, "media-1.bin");
  });
});
