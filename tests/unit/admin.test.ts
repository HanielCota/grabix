import assert from "node:assert/strict";
import { mock, test } from "node:test";

// mock.module exige a flag --experimental-test-module-mocks. Sem ela, os testes
// que dependem de DB são pulados (funções puras baseadas em env rodam sempre).
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP_DB = "requer node --experimental-test-module-mocks para mockar @/server/db";

// ─── Fake do Drizzle: encadeia select().from().where().limit() ───

let dbRows: Array<{ isAdmin: boolean }> = [];
let selectCalls = 0;
let limitArg: number | undefined;

const fakeDb = {
  select(_fields: unknown) {
    selectCalls += 1;
    return {
      from(_table: unknown) {
        return {
          where(_cond: unknown) {
            return {
              limit(n: number) {
                limitArg = n;
                return Promise.resolve(dbRows);
              },
            };
          },
        };
      },
    };
  },
};

if (canMockModules) {
  mock.module("@/server/db", { namedExports: { getDb: () => fakeDb } });
}

async function importAdmin() {
  return import("../../src/server/admin.ts");
}

// admin.ts lê process.env.ADMIN_EMAILS em cada chamada; salvar/restaurar por teste.
const savedAdminEmails = process.env.ADMIN_EMAILS;

function setAdminEmails(value: string | undefined) {
  if (value === undefined) {
    delete process.env.ADMIN_EMAILS;
  } else {
    process.env.ADMIN_EMAILS = value;
  }
}

test.after(() => {
  setAdminEmails(savedAdminEmails);
});

// ─── adminEmails ───

test("adminEmails: variável ausente retorna lista vazia", async () => {
  setAdminEmails(undefined);
  const { adminEmails } = await importAdmin();
  assert.deepEqual(adminEmails(), []);
});

test("adminEmails: string vazia retorna lista vazia", async () => {
  setAdminEmails("");
  const { adminEmails } = await importAdmin();
  assert.deepEqual(adminEmails(), []);
});

test("adminEmails: e-mail único", async () => {
  setAdminEmails("admin@exemplo.com");
  const { adminEmails } = await importAdmin();
  assert.deepEqual(adminEmails(), ["admin@exemplo.com"]);
});

test("adminEmails: múltiplos e-mails com espaços, vírgulas vazias e case misto", async () => {
  setAdminEmails("  Ana@X.com ,, bob@y.com , ,CAROL@Z.COM  ");
  const { adminEmails } = await importAdmin();
  assert.deepEqual(adminEmails(), ["ana@x.com", "bob@y.com", "carol@z.com"]);
});

// ─── isEnvAdmin ───

test("isEnvAdmin: true para e-mail da lista, ignorando case", async () => {
  setAdminEmails("admin@exemplo.com");
  const { isEnvAdmin } = await importAdmin();
  assert.equal(isEnvAdmin("admin@exemplo.com"), true);
  assert.equal(isEnvAdmin("ADMIN@EXEMPLO.COM"), true);
});

test("isEnvAdmin: false para e-mail fora da lista", async () => {
  setAdminEmails("admin@exemplo.com");
  const { isEnvAdmin } = await importAdmin();
  assert.equal(isEnvAdmin("outro@exemplo.com"), false);
});

test("isEnvAdmin: false para null, undefined e string vazia", async () => {
  setAdminEmails("admin@exemplo.com");
  const { isEnvAdmin } = await importAdmin();
  assert.equal(isEnvAdmin(null), false);
  assert.equal(isEnvAdmin(undefined), false);
  assert.equal(isEnvAdmin(""), false);
});

test("isEnvAdmin: false quando a lista está vazia", async () => {
  setAdminEmails(undefined);
  const { isEnvAdmin } = await importAdmin();
  assert.equal(isEnvAdmin("admin@exemplo.com"), false);
});

// ─── isAdmin ───

test("isAdmin: e-mail de env-admin retorna true sem consultar o DB", { skip: !canMockModules && SKIP_DB }, async () => {
  setAdminEmails("admin@exemplo.com");
  const { isAdmin } = await importAdmin();
  selectCalls = 0;
  assert.equal(await isAdmin("user-1", "Admin@Exemplo.com"), true);
  assert.equal(selectCalls, 0, "env-admin deve fazer short-circuit antes do DB");
});

test("isAdmin: flag isAdmin=true no DB retorna true", { skip: !canMockModules && SKIP_DB }, async () => {
  setAdminEmails(undefined);
  const { isAdmin } = await importAdmin();
  dbRows = [{ isAdmin: true }];
  selectCalls = 0;
  limitArg = undefined;
  assert.equal(await isAdmin("user-2", "comum@exemplo.com"), true);
  assert.equal(selectCalls, 1);
  assert.equal(limitArg, 1, "consulta deve limitar a 1 linha");
});

test("isAdmin: flag isAdmin=false no DB retorna false", { skip: !canMockModules && SKIP_DB }, async () => {
  setAdminEmails(undefined);
  const { isAdmin } = await importAdmin();
  dbRows = [{ isAdmin: false }];
  assert.equal(await isAdmin("user-3", "comum@exemplo.com"), false);
});

test("isAdmin: usuário inexistente no DB retorna false", { skip: !canMockModules && SKIP_DB }, async () => {
  setAdminEmails(undefined);
  const { isAdmin } = await importAdmin();
  dbRows = [];
  assert.equal(await isAdmin("user-4", "comum@exemplo.com"), false);
});

test("isAdmin: sem e-mail (null) ainda consulta o DB", { skip: !canMockModules && SKIP_DB }, async () => {
  setAdminEmails(undefined);
  const { isAdmin } = await importAdmin();
  dbRows = [{ isAdmin: true }];
  selectCalls = 0;
  assert.equal(await isAdmin("user-5", null), true);
  assert.equal(selectCalls, 1);
});
