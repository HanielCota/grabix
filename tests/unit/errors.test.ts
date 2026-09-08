import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppError, Errors } from "../../src/features/media-downloader/domain/errors.ts";

describe("AppError", () => {
  test("é uma instância de Error com name AppError", () => {
    const err = new AppError("falhou", "CODE_X");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof AppError);
    assert.equal(err.name, "AppError");
  });

  test("guarda message e code", () => {
    const err = new AppError("mensagem qualquer", "MEU_CODIGO");
    assert.equal(err.message, "mensagem qualquer");
    assert.equal(err.code, "MEU_CODIGO");
  });

  test("statusCode padrão é 400", () => {
    const err = new AppError("msg", "CODE");
    assert.equal(err.statusCode, 400);
  });

  test("aceita statusCode customizado", () => {
    const err = new AppError("msg", "CODE", 503);
    assert.equal(err.statusCode, 503);
  });

  test("possui stack trace", () => {
    const err = new AppError("msg", "CODE");
    assert.equal(typeof err.stack, "string");
    assert.ok(err.stack?.includes("AppError"));
  });

  test("toJSON retorna shape { error: { code, message } }", () => {
    const err = new AppError("detalhe aqui", "CODIGO_JSON", 422);
    assert.deepEqual(err.toJSON(), {
      error: {
        code: "CODIGO_JSON",
        message: "detalhe aqui",
      },
    });
  });

  test("toJSON não expõe statusCode", () => {
    const err = new AppError("msg", "CODE", 500);
    const json = err.toJSON() as Record<string, unknown>;
    assert.equal("statusCode" in json, false);
    assert.equal("statusCode" in (json.error as object), false);
  });
});

describe("Errors - factories", () => {
  test("invalidUrl sem detalhe usa mensagem padrão", () => {
    const err = Errors.invalidUrl();
    assert.equal(err.code, "INVALID_URL");
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, "URL inválida.");
  });

  test("invalidUrl com detalhe usa o detalhe como mensagem", () => {
    const err = Errors.invalidUrl("URL não pode ser vazia.");
    assert.equal(err.code, "INVALID_URL");
    assert.equal(err.message, "URL não pode ser vazia.");
  });

  test("ssrfBlocked retorna 403", () => {
    const err = Errors.ssrfBlocked();
    assert.equal(err.code, "SSRF_BLOCKED");
    assert.equal(err.statusCode, 403);
    assert.match(err.message, /restrito/);
  });

  test("fetchFailed embute o motivo na mensagem e usa 502", () => {
    const err = Errors.fetchFailed("Timeout ao buscar página.");
    assert.equal(err.code, "FETCH_FAILED");
    assert.equal(err.statusCode, 502);
    assert.equal(err.message, "Erro ao buscar: Timeout ao buscar página.");
  });

  test("notHtml", () => {
    const err = Errors.notHtml();
    assert.equal(err.code, "NOT_HTML");
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, "Resposta não é HTML.");
  });

  test("htmlTooLarge", () => {
    const err = Errors.htmlTooLarge();
    assert.equal(err.code, "HTML_TOO_LARGE");
    assert.equal(err.statusCode, 400);
  });

  test("tooManyAssets", () => {
    const err = Errors.tooManyAssets();
    assert.equal(err.code, "TOO_MANY_ASSETS");
    assert.equal(err.statusCode, 400);
  });

  test("fileTooLarge", () => {
    const err = Errors.fileTooLarge();
    assert.equal(err.code, "FILE_TOO_LARGE");
    assert.equal(err.statusCode, 400);
  });

  test("zipTooLarge", () => {
    const err = Errors.zipTooLarge();
    assert.equal(err.code, "ZIP_TOO_LARGE");
    assert.equal(err.statusCode, 400);
  });

  test("downloadFailed embute o motivo e usa 502", () => {
    const err = Errors.downloadFailed("Status HTTP 404");
    assert.equal(err.code, "DOWNLOAD_FAILED");
    assert.equal(err.statusCode, 502);
    assert.equal(err.message, "Erro no download: Status HTTP 404");
  });

  test("invalidMediaType", () => {
    const err = Errors.invalidMediaType();
    assert.equal(err.code, "INVALID_MEDIA_TYPE");
    assert.equal(err.statusCode, 400);
  });

  test("unauthorized retorna 401", () => {
    const err = Errors.unauthorized();
    assert.equal(err.code, "UNAUTHORIZED");
    assert.equal(err.statusCode, 401);
  });

  test("forbidden retorna 403", () => {
    const err = Errors.forbidden();
    assert.equal(err.code, "FORBIDDEN");
    assert.equal(err.statusCode, 403);
  });

  test("upgradeRequired sem detalhe usa mensagem padrão e 402", () => {
    const err = Errors.upgradeRequired();
    assert.equal(err.code, "UPGRADE_REQUIRED");
    assert.equal(err.statusCode, 402);
    assert.match(err.message, /Pro/);
  });

  test("upgradeRequired com detalhe usa o detalhe", () => {
    const err = Errors.upgradeRequired("Recurso exclusivo.");
    assert.equal(err.message, "Recurso exclusivo.");
    assert.equal(err.code, "UPGRADE_REQUIRED");
  });

  test("quotaExceeded retorna 402", () => {
    const err = Errors.quotaExceeded();
    assert.equal(err.code, "QUOTA_EXCEEDED");
    assert.equal(err.statusCode, 402);
  });

  test("rateLimited retorna 429", () => {
    const err = Errors.rateLimited();
    assert.equal(err.code, "RATE_LIMITED");
    assert.equal(err.statusCode, 429);
  });

  test("cada chamada retorna uma nova instância", () => {
    const a = Errors.invalidUrl();
    const b = Errors.invalidUrl();
    assert.notEqual(a, b);
    assert.deepEqual(a.toJSON(), b.toJSON());
  });

  test("todas as factories retornam AppError", () => {
    const all = [
      Errors.invalidUrl(),
      Errors.ssrfBlocked(),
      Errors.fetchFailed("x"),
      Errors.notHtml(),
      Errors.htmlTooLarge(),
      Errors.tooManyAssets(),
      Errors.fileTooLarge(),
      Errors.zipTooLarge(),
      Errors.downloadFailed("x"),
      Errors.invalidMediaType(),
      Errors.unauthorized(),
      Errors.forbidden(),
      Errors.upgradeRequired(),
      Errors.quotaExceeded(),
      Errors.rateLimited(),
    ];
    for (const err of all) {
      assert.ok(err instanceof AppError, `${err.code} deveria ser AppError`);
    }
  });
});
