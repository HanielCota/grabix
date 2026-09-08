import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { accounts, sessions, users, verificationTokens } from "../../src/server/db/schema.ts";

// src/auth.ts chama NextAuth({...}) e DrizzleAdapter(getDb(), ...) no momento do
// import. Para avaliar o módulo sem banco e sem o NextAuth real, todas as
// dependências externas são mockadas (requer --experimental-test-module-mocks).
// O default export mockado de "next-auth" captura o objeto de configuração,
// que é o que os testes inspecionam.

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = "requer node --experimental-test-module-mocks para isolar next-auth/db";

interface JwtToken {
  id?: string;
  [key: string]: unknown;
}

interface AuthConfigCapturado {
  adapter: unknown;
  session: { strategy: string };
  providers: unknown[];
  pages: { signIn: string };
  callbacks: {
    jwt: (args: { token: JwtToken; user?: { id?: string } | null }) => JwtToken;
    session: (args: { session: { user?: { id?: string } | null }; token: JwtToken }) => {
      user?: { id?: string } | null;
    };
    signIn: (args: { user?: { id?: string; email?: string | null } | null }) => Promise<boolean>;
  };
}

let capturedConfig: AuthConfigCapturado | null = null;
let adapterArgs: { db: unknown; tables: Record<string, unknown> } | null = null;
const fakeDb = { __fakeDb: true };
const googleProviderStub = () => ({ id: "google" });

type ClaimFn = (email: string, userId: string) => Promise<void>;
let claimImpl: ClaimFn = async () => {};
const claimCalls: Array<{ email: string; userId: string }> = [];

if (canMockModules) {
  mock.module("next-auth", {
    defaultExport: (config: AuthConfigCapturado) => {
      capturedConfig = config;
      return {
        handlers: { GET: () => {}, POST: () => {} },
        auth: async () => null,
        signIn: async () => {},
        signOut: async () => {},
      };
    },
  });
  mock.module("next-auth/providers/google", { defaultExport: googleProviderStub });
  mock.module("@auth/drizzle-adapter", {
    namedExports: {
      DrizzleAdapter: (db: unknown, tables: Record<string, unknown>) => {
        adapterArgs = { db, tables };
        return { __kind: "drizzle-adapter-mock" };
      },
    },
  });
  mock.module("@/server/db", { namedExports: { getDb: () => fakeDb } });
  mock.module("@/server/entitlements", {
    namedExports: {
      claimPendingEntitlements: async (email: string, userId: string) => {
        claimCalls.push({ email, userId });
        return claimImpl(email, userId);
      },
    },
  });
}

async function importAuthConfig(): Promise<AuthConfigCapturado> {
  await import("../../src/auth.ts");
  assert.ok(capturedConfig, "NextAuth deveria ter sido chamado com a configuração");
  return capturedConfig;
}

function resetSpies() {
  claimCalls.length = 0;
  claimImpl = async () => {};
}

// ─── Configuração estática ───

test("usa estratégia de sessão JWT e página de sign-in customizada", { skip: !canMockModules && SKIP }, async () => {
  const config = await importAuthConfig();
  assert.deepEqual(config.session, { strategy: "jwt" });
  assert.deepEqual(config.pages, { signIn: "/sign-in" });
});

test("registra exatamente o provider Google", { skip: !canMockModules && SKIP }, async () => {
  const config = await importAuthConfig();
  assert.equal(config.providers.length, 1);
  assert.equal(config.providers[0], googleProviderStub);
});

test("configura o DrizzleAdapter com o db e as quatro tabelas do Auth.js", {
  skip: !canMockModules && SKIP,
}, async () => {
  const config = await importAuthConfig();
  assert.deepEqual(config.adapter, { __kind: "drizzle-adapter-mock" });
  assert.ok(adapterArgs);
  assert.equal(adapterArgs.db, fakeDb, "adapter deve receber o db de getDb()");
  assert.equal(adapterArgs.tables.usersTable, users);
  assert.equal(adapterArgs.tables.accountsTable, accounts);
  assert.equal(adapterArgs.tables.sessionsTable, sessions);
  assert.equal(adapterArgs.tables.verificationTokensTable, verificationTokens);
});

test("exporta handlers, auth, signIn e signOut", { skip: !canMockModules && SKIP }, async () => {
  const mod = await import("../../src/auth.ts");
  assert.ok(mod.handlers);
  assert.equal(typeof mod.auth, "function");
  assert.equal(typeof mod.signIn, "function");
  assert.equal(typeof mod.signOut, "function");
});

// ─── Callback jwt ───

test("callback jwt copia user.id para o token", { skip: !canMockModules && SKIP }, async () => {
  const config = await importAuthConfig();
  const token = config.callbacks.jwt({ token: { sub: "abc" }, user: { id: "user-1" } });
  assert.equal(token.id, "user-1");
  assert.equal(token.sub, "abc", "demais campos do token são preservados");
});

test("callback jwt não altera o token sem user ou sem user.id", { skip: !canMockModules && SKIP }, async () => {
  const config = await importAuthConfig();
  const semUser = config.callbacks.jwt({ token: { sub: "abc" } });
  assert.equal(semUser.id, undefined);
  const semId = config.callbacks.jwt({ token: { sub: "abc" }, user: {} });
  assert.equal(semId.id, undefined);
  const userNull = config.callbacks.jwt({ token: { sub: "abc" }, user: null });
  assert.equal(userNull.id, undefined);
});

// ─── Callback session ───

test("callback session propaga token.id para session.user.id", { skip: !canMockModules && SKIP }, async () => {
  const config = await importAuthConfig();
  const session = config.callbacks.session({
    session: { user: { id: undefined } },
    token: { id: "user-42" },
  });
  assert.equal(session.user?.id, "user-42");
});

test("callback session não quebra sem token.id ou sem session.user", { skip: !canMockModules && SKIP }, async () => {
  const config = await importAuthConfig();
  const semTokenId = config.callbacks.session({ session: { user: {} }, token: {} });
  assert.equal(semTokenId.user?.id, undefined);
  const semUser = config.callbacks.session({ session: { user: null }, token: { id: "user-42" } });
  assert.equal(semUser.user, null);
});

// ─── Callback signIn (reivindicação de entitlements) ───

test("callback signIn reivindica entitlements pendentes e retorna true", {
  skip: !canMockModules && SKIP,
}, async () => {
  const config = await importAuthConfig();
  resetSpies();
  const permitido = await config.callbacks.signIn({ user: { id: "user-9", email: "pro@example.com" } });
  assert.equal(permitido, true);
  assert.deepEqual(claimCalls, [{ email: "pro@example.com", userId: "user-9" }]);
});

test("callback signIn não bloqueia o login quando a reivindicação falha", {
  skip: !canMockModules && SKIP,
}, async () => {
  const config = await importAuthConfig();
  resetSpies();
  claimImpl = async () => {
    throw new Error("banco indisponível");
  };
  // O callback avisa via console.warn; silencia para não poluir a saída.
  // biome-ignore lint/suspicious/noConsole: captura o aviso operacional do callback signIn
  const warnOriginal = console.warn;
  const avisos: unknown[] = [];
  console.warn = (...args: unknown[]) => {
    avisos.push(args);
  };
  try {
    const permitido = await config.callbacks.signIn({ user: { id: "user-9", email: "pro@example.com" } });
    assert.equal(permitido, true, "login nunca deve ser bloqueado por falha na reivindicação");
    assert.equal(avisos.length, 1, "falha deve gerar um aviso operacional");
  } finally {
    console.warn = warnOriginal;
  }
});

test("callback signIn sem id/email não chama a reivindicação", { skip: !canMockModules && SKIP }, async () => {
  const config = await importAuthConfig();
  resetSpies();
  assert.equal(await config.callbacks.signIn({ user: { email: "sem-id@example.com" } }), true);
  assert.equal(await config.callbacks.signIn({ user: { id: "user-1" } }), true);
  assert.equal(await config.callbacks.signIn({ user: null }), true);
  assert.equal(await config.callbacks.signIn({}), true);
  assert.deepEqual(claimCalls, [], "reivindicação exige id E email");
});
