import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AppError } from "../../src/features/media-downloader/domain/errors.ts";

// auth-guard depende de next-auth (@/auth) e do DB via @/server/admin.
// Ambos são mockados com mock.module (requer --experimental-test-module-mocks);
// sem a flag, o arquivo inteiro é pulado — não há nada testável isoladamente,
// pois importar @/auth real exigiria DATABASE_URL e inicializaria o NextAuth.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = "requer node --experimental-test-module-mocks para mockar @/auth e @/server/admin";

type Session = { user?: { id?: string; email?: string | null; name?: string | null } } | null;

let sessionImpl: Session = null;
let isAdminImpl: (userId: string, email?: string | null) => Promise<boolean> = async () => false;
const isAdminCalls: Array<{ userId: string; email?: string | null }> = [];

if (canMockModules) {
  mock.module("@/auth", {
    namedExports: { auth: () => Promise.resolve(sessionImpl) },
  });
  mock.module("@/server/admin", {
    namedExports: {
      isAdmin: (userId: string, email?: string | null) => {
        isAdminCalls.push({ userId, email });
        return isAdminImpl(userId, email);
      },
    },
  });
}

async function importGuard() {
  return import("../../src/server/auth-guard.ts");
}

// ─── requireUser ───

test("requireUser: sessão nula lança 401 UNAUTHORIZED", { skip: !canMockModules && SKIP }, async () => {
  const { requireUser } = await importGuard();
  sessionImpl = null;
  const err = await requireUser().catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "UNAUTHORIZED");
  assert.equal(err.statusCode, 401);
});

test("requireUser: sessão sem user lança 401", { skip: !canMockModules && SKIP }, async () => {
  const { requireUser } = await importGuard();
  sessionImpl = {};
  await assert.rejects(
    () => requireUser(),
    (e: unknown) => e instanceof AppError && e.code === "UNAUTHORIZED",
  );
});

test("requireUser: user sem id lança 401", { skip: !canMockModules && SKIP }, async () => {
  const { requireUser } = await importGuard();
  sessionImpl = { user: { email: "a@b.com" } };
  await assert.rejects(
    () => requireUser(),
    (e: unknown) => e instanceof AppError && e.code === "UNAUTHORIZED",
  );
});

test("requireUser: user com id vazio lança 401", { skip: !canMockModules && SKIP }, async () => {
  const { requireUser } = await importGuard();
  sessionImpl = { user: { id: "" } };
  await assert.rejects(
    () => requireUser(),
    (e: unknown) => e instanceof AppError && e.code === "UNAUTHORIZED",
  );
});

test("requireUser: sessão completa retorna id, email e name", { skip: !canMockModules && SKIP }, async () => {
  const { requireUser } = await importGuard();
  sessionImpl = { user: { id: "u-1", email: "ana@x.com", name: "Ana" } };
  const user = await requireUser();
  assert.deepEqual(user, { id: "u-1", email: "ana@x.com", name: "Ana" });
});

test("requireUser: sessão só com id retorna email/name como undefined", { skip: !canMockModules && SKIP }, async () => {
  const { requireUser } = await importGuard();
  sessionImpl = { user: { id: "u-2" } };
  const user = await requireUser();
  assert.equal(user.id, "u-2");
  assert.equal(user.email, undefined);
  assert.equal(user.name, undefined);
});

test("requireUser: email/name nulos são preservados como null", { skip: !canMockModules && SKIP }, async () => {
  const { requireUser } = await importGuard();
  sessionImpl = { user: { id: "u-3", email: null, name: null } };
  const user = await requireUser();
  assert.equal(user.email, null);
  assert.equal(user.name, null);
});

// ─── requireAdmin ───

test("requireAdmin: usuário admin retorna o próprio usuário", { skip: !canMockModules && SKIP }, async () => {
  const { requireAdmin } = await importGuard();
  sessionImpl = { user: { id: "u-admin", email: "admin@x.com", name: "Root" } };
  isAdminImpl = async () => true;
  isAdminCalls.length = 0;
  const user = await requireAdmin();
  assert.equal(user.id, "u-admin");
  assert.deepEqual(isAdminCalls, [{ userId: "u-admin", email: "admin@x.com" }]);
});

test("requireAdmin: não-admin lança 403 FORBIDDEN", { skip: !canMockModules && SKIP }, async () => {
  const { requireAdmin } = await importGuard();
  sessionImpl = { user: { id: "u-comum", email: "comum@x.com" } };
  isAdminImpl = async () => false;
  const err = await requireAdmin().catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, "FORBIDDEN");
  assert.equal(err.statusCode, 403);
});

test("requireAdmin: sem sessão lança 401 e nem consulta isAdmin", { skip: !canMockModules && SKIP }, async () => {
  const { requireAdmin } = await importGuard();
  sessionImpl = null;
  isAdminCalls.length = 0;
  await assert.rejects(
    () => requireAdmin(),
    (e: unknown) => e instanceof AppError && e.code === "UNAUTHORIZED",
  );
  assert.equal(isAdminCalls.length, 0);
});

test("requireAdmin: repassa email null para isAdmin", { skip: !canMockModules && SKIP }, async () => {
  const { requireAdmin } = await importGuard();
  sessionImpl = { user: { id: "u-null-mail", email: null } };
  isAdminImpl = async () => true;
  isAdminCalls.length = 0;
  await requireAdmin();
  assert.deepEqual(isAdminCalls, [{ userId: "u-null-mail", email: null }]);
});
