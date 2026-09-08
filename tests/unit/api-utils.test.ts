import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";
import { handleApiError } from "../../src/server/api-utils.ts";

async function bodyOf(res: Response) {
  return res.json();
}

// ─── AppError ───

test("AppError usa o statusCode e o payload do próprio erro", async () => {
  const err = new AppError("Faça login para continuar.", "UNAUTHORIZED", 401);
  const res = await handleApiError(err);
  assert.equal(res.status, 401);
  assert.deepEqual(await bodyOf(res), {
    error: { code: "UNAUTHORIZED", message: "Faça login para continuar." },
  });
});

test("AppError sem statusCode explícito usa 400", async () => {
  const res = await handleApiError(new AppError("URL inválida.", "INVALID_URL"));
  assert.equal(res.status, 400);
  assert.deepEqual(await bodyOf(res), { error: { code: "INVALID_URL", message: "URL inválida." } });
});

test("subclasse de AppError também é tratada como AppError", async () => {
  class CustomError extends AppError {}
  const res = await handleApiError(new CustomError("Custom.", "CUSTOM", 418));
  assert.equal(res.status, 418);
  assert.deepEqual(await bodyOf(res), { error: { code: "CUSTOM", message: "Custom." } });
});

// ─── SyntaxError ───

test("SyntaxError vira 400 INVALID_JSON", async () => {
  const res = await handleApiError(new SyntaxError("Unexpected token <"));
  assert.equal(res.status, 400);
  assert.deepEqual(await bodyOf(res), {
    error: { code: "INVALID_JSON", message: "Corpo da requisição não é JSON válido." },
  });
});

test("SyntaxError de um JSON.parse real é reconhecido", async () => {
  let caught: unknown;
  try {
    JSON.parse("{não é json");
  } catch (err) {
    caught = err;
  }
  const res = await handleApiError(caught);
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INVALID_JSON");
});

// ─── ZodError ───

test("ZodError vira 400 VALIDATION_ERROR com as issues em details", async () => {
  const schema = z.object({ url: z.string().url(), limit: z.number().int() });
  const parsed = schema.safeParse({ url: "não-url", limit: 1.5 });
  assert.equal(parsed.success, false);
  const res = await handleApiError(parsed.error);
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.message, "Dados inválidos.");
  assert.ok(Array.isArray(body.error.details));
  assert.equal(body.error.details.length, 2);
  assert.deepEqual(body.error.details[0].path, ["url"]);
  assert.deepEqual(body.error.details[1].path, ["limit"]);
});

test("ZodError com objeto totalmente errado ainda retorna details", async () => {
  const schema = z.object({ a: z.string() });
  const parsed = schema.safeParse(42);
  assert.equal(parsed.success, false);
  const res = await handleApiError(parsed.error);
  assert.equal(res.status, 400);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(body.error.details));
});

// ─── Erros desconhecidos ───

test("Error genérico vira 500 INTERNAL_ERROR sem vazar a mensagem", async () => {
  const res = await handleApiError(new Error("segredo interno do servidor"));
  assert.equal(res.status, 500);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "Erro interno do servidor.");
  assert.ok(!JSON.stringify(body).includes("segredo interno"));
});

test("valores não-Error (string, número, null, undefined, objeto) viram 500", async () => {
  for (const value of ["boom", 42, null, undefined, { code: "X" }, ["err"]]) {
    const res = await handleApiError(value);
    assert.equal(res.status, 500, `value=${JSON.stringify(value)}`);
    const body = await bodyOf(res);
    assert.equal(body.error.code, "INTERNAL_ERROR");
  }
});

test("objeto com cara de AppError mas sem herdar dele cai no 500", async () => {
  const duckTyped = { name: "AppError", code: "INVALID_URL", statusCode: 400, message: "fake" };
  const res = await handleApiError(duckTyped);
  assert.equal(res.status, 500);
});

// ─── Precedência ───

test("AppError tem precedência e não é confundido com erro genérico", async () => {
  // AppError estende Error; a checagem instanceof AppError precisa vir primeiro.
  const res = await handleApiError(new AppError("Limite atingido.", "QUOTA_EXCEEDED", 402));
  assert.equal(res.status, 402);
  const body = await bodyOf(res);
  assert.equal(body.error.code, "QUOTA_EXCEEDED");
});

test("resposta tem content-type JSON", async () => {
  const res = await handleApiError(new Error("x"));
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
});
