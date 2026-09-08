import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";
import { users } from "../../src/server/db/schema.ts";

// Testa a rota DELETE /api/account (src/app/api/account/route.ts) com
// requireUser e o DB mockados; handleApiError e AppError são reais, então a
// tradução erro → status HTTP também fica coberta. Requer
// --experimental-test-module-mocks.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const needsMock = { skip: !canMockModules && "requer node --experimental-test-module-mocks" };

type User = { id: string; email?: string | null };

let userImpl: User | null = { id: "u-1", email: "ana@x.com" };
let authError: Error | null = null;
let dbError: Error | null = null;
const deleteCalls: Array<{ table: unknown }> = [];

function makeChain(): unknown {
  const chain: unknown = new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          if (dbError) reject(dbError);
          else resolve([]);
        };
      }
      if (prop === "catch" || prop === "finally") return () => chain;
      return (...args: unknown[]) => {
        if (String(prop) === "delete") deleteCalls.push({ table: args[0] });
        return chain;
      };
    },
  });
  return chain;
}

if (canMockModules) {
  mock.module("@/server/auth-guard", {
    namedExports: {
      requireUser: () => {
        if (authError) return Promise.reject(authError);
        return Promise.resolve(userImpl);
      },
    },
  });
  // @types/node ainda não tipa a opção `exports` (antiga `namedExports`)
  mock.module("@/server/db", { exports: { getDb: () => makeChain() } } as Parameters<typeof mock.module>[1]);
}

async function importRoute() {
  return import("../../src/app/api/account/route.ts");
}

function reset() {
  userImpl = { id: "u-1", email: "ana@x.com" };
  authError = null;
  dbError = null;
  deleteCalls.length = 0;
}

// ─── Caminho feliz ───

test("DELETE /api/account: apaga o usuário na tabela users e retorna ok", needsMock, async () => {
  const { DELETE } = await importRoute();
  reset();
  const res = await DELETE();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].table, users); // schema real: confirma a tabela alvo
});

// ─── Não autenticado ───

test("DELETE /api/account: sem sessão retorna 401 UNAUTHORIZED e não toca no DB", needsMock, async () => {
  const { DELETE } = await importRoute();
  reset();
  authError = new AppError("Faça login para continuar.", "UNAUTHORIZED", 401);
  const res = await DELETE();
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.equal(deleteCalls.length, 0);
});

// ─── Erros de dependência ───

test("DELETE /api/account: falha do DB vira 500 INTERNAL_ERROR", needsMock, async () => {
  const { DELETE } = await importRoute();
  reset();
  dbError = new Error("connection reset");
  const res = await DELETE();
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "Erro interno do servidor."); // não vaza o erro original
});

test("DELETE /api/account: AppError de domínio preserva code e status", needsMock, async () => {
  const { DELETE } = await importRoute();
  reset();
  dbError = new AppError("Recurso disponível apenas no plano Pro.", "UPGRADE_REQUIRED", 402);
  const res = await DELETE();
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.error.code, "UPGRADE_REQUIRED");
});
