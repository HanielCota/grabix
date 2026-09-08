import assert from "node:assert/strict";
import { mock, test } from "node:test";

// mock.module (intercepção de módulos ESM) só existe com a flag
// --experimental-test-module-mocks. Sem ela, os testes que dependem de DB são
// pulados e os testes de isActionableFailure (função pura) ainda rodam.
const MODULE_MOCK_AVAILABLE = typeof (mock as unknown as { module?: unknown }).module === "function";

// ─── Fake de DB: proxy thenable que registra cada método do query builder ───

type DbCall = { method: string; args: unknown[] };
const dbCalls: DbCall[] = [];
let dbResult: unknown = [];
let dbError: Error | null = null;

function resetDb() {
  dbCalls.length = 0;
  dbResult = [];
  dbError = null;
}

function makeChain(): unknown {
  const chain: unknown = new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          if (dbError) reject(dbError);
          else resolve(dbResult);
        };
      }
      if (prop === "catch" || prop === "finally") return () => chain;
      return (...args: unknown[]) => {
        dbCalls.push({ method: String(prop), args });
        return chain;
      };
    },
  });
  return chain;
}

// drizzle-orm mockado para capturar os argumentos dos operadores (eq, ilike...)
const ilikeTerms: string[] = [];
const drizzleMock = {
  and: (...args: unknown[]) => ({ op: "and", args }),
  or: (...args: unknown[]) => ({ op: "or", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  desc: (col: unknown) => ({ op: "desc", args: [col] }),
  ilike: (col: unknown, term: string) => {
    ilikeTerms.push(term);
    return { op: "ilike", args: [col, term] };
  },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    strings: Array.from(strings),
    values,
  }),
};

if (MODULE_MOCK_AVAILABLE) {
  // @types/node (22) ainda não tipa a opção `exports` do Node 26 (antiga `namedExports`)
  const opts = { exports: drizzleMock } as Parameters<typeof mock.module>[1];
  mock.module("drizzle-orm", opts);
  mock.module("@/server/db", { exports: { getDb: () => makeChain() } } as typeof opts);
}

// Import DEPOIS de registrar os mocks (o módulo é carregado uma única vez).
const urlFailures = await import("../../src/server/url-failures.ts");

const needsMock = { skip: !MODULE_MOCK_AVAILABLE && "requer --experimental-test-module-mocks" };

function callsOf(method: string): DbCall[] {
  return dbCalls.filter((c) => c.method === method);
}

// ─── isActionableFailure (puro) ───

test("isActionableFailure aceita os motivos acionáveis", () => {
  for (const reason of ["FETCH_FAILED", "NOT_HTML", "HTML_TOO_LARGE", "NO_MEDIA", "CRAWL_ERROR", "INTERNAL_ERROR"]) {
    assert.equal(urlFailures.isActionableFailure(reason), true, reason);
  }
});

test("isActionableFailure rejeita erros do lado do usuário e variações", () => {
  for (const reason of [
    "UNAUTHORIZED",
    "QUOTA_EXCEEDED",
    "RATE_LIMITED",
    "INVALID_URL",
    "SSRF_BLOCKED",
    "UPGRADE_REQUIRED",
    "VALIDATION_ERROR",
    "",
    "fetch_failed", // case-sensitive
    " FETCH_FAILED",
    "FETCH_FAILED ",
  ]) {
    assert.equal(urlFailures.isActionableFailure(reason), false, JSON.stringify(reason));
  }
});

// ─── recordUrlFailure: early returns (não tocam o DB) ───

test("recordUrlFailure ignora URL vazia sem tocar o DB", async () => {
  resetDb();
  await urlFailures.recordUrlFailure({ url: "", reason: "FETCH_FAILED" });
  assert.equal(dbCalls.length, 0);
});

test("recordUrlFailure ignora motivo não acionável sem tocar o DB", async () => {
  resetDb();
  await urlFailures.recordUrlFailure({ url: "https://example.com", reason: "QUOTA_EXCEEDED" });
  assert.equal(dbCalls.length, 0);
});

// ─── recordUrlFailure: comportamento com DB mockado ───

test("recordUrlFailure insere com defaults (deepCrawl false, userId null)", needsMock, async () => {
  resetDb();
  await urlFailures.recordUrlFailure({ url: "https://www.example.com/pagina", reason: "NO_MEDIA" });

  const valuesCall = callsOf("values")[0];
  assert.ok(valuesCall, "values() deveria ter sido chamado");
  assert.deepEqual(valuesCall.args[0], {
    url: "https://www.example.com/pagina",
    host: "example.com", // www. removido
    reason: "NO_MEDIA",
    message: null,
    deepCrawl: false,
    lastUserId: null,
  });

  const conflict = callsOf("onConflictDoUpdate")[0];
  assert.ok(conflict, "onConflictDoUpdate() deveria ter sido chamado");
  const set = (conflict.args[0] as { set: Record<string, unknown> }).set;
  assert.equal(set.resolved, false); // nova ocorrência reabre a linha
  assert.equal(set.message, null);
  assert.ok(set.lastSeenAt instanceof Date);
  assert.equal((set.count as { op: string }).op, "sql"); // count = count + 1
});

test("recordUrlFailure respeita deepCrawl, userId e message explícitos", needsMock, async () => {
  resetDb();
  await urlFailures.recordUrlFailure({
    url: "https://example.com",
    reason: "CRAWL_ERROR",
    message: "boom",
    deepCrawl: true,
    userId: "user-1",
  });
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal(values.message, "boom");
  assert.equal(values.deepCrawl, true);
  assert.equal(values.lastUserId, "user-1");
});

test("recordUrlFailure usa '-' como host para URL malformada", needsMock, async () => {
  resetDb();
  await urlFailures.recordUrlFailure({ url: "não-é-url", reason: "FETCH_FAILED" });
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal(values.host, "-");
});

test("recordUrlFailure não inclui porta no host", needsMock, async () => {
  resetDb();
  await urlFailures.recordUrlFailure({ url: "http://example.com:8080/x", reason: "FETCH_FAILED" });
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal(values.host, "example.com");
});

test("recordUrlFailure trunca URL em 2048 chars e message em 500", needsMock, async () => {
  resetDb();
  await urlFailures.recordUrlFailure({
    url: `https://example.com/${"a".repeat(3000)}`,
    reason: "FETCH_FAILED",
    message: "m".repeat(1000),
  });
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal((values.url as string).length, 2048);
  assert.equal((values.message as string).length, 500);
});

test("recordUrlFailure trata message null como null", needsMock, async () => {
  resetDb();
  await urlFailures.recordUrlFailure({ url: "https://example.com", reason: "NOT_HTML", message: null });
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal(values.message, null);
});

test("recordUrlFailure nunca lança mesmo quando o DB falha (telemetria best-effort)", needsMock, async () => {
  resetDb();
  dbError = new Error("connection refused");
  await assert.doesNotReject(() =>
    urlFailures.recordUrlFailure({ url: "https://example.com", reason: "INTERNAL_ERROR" }),
  );
});

// ─── listUrlFailures ───

test("listUrlFailures filtra resolved=false por padrão e limita a 200", needsMock, async () => {
  resetDb();
  dbResult = [{ id: "1" }];
  const rows = await urlFailures.listUrlFailures({});
  assert.deepEqual(rows, [{ id: "1" }]);

  assert.equal(callsOf("limit")[0].args[0], 200);
  assert.equal(callsOf("orderBy").length, 1);

  const whereArg = callsOf("where")[0].args[0] as { op: string; args: Array<{ op: string; args: unknown[] }> };
  assert.equal(whereArg.op, "and");
  const resolvedCond = whereArg.args.find((c) => c.op === "eq" && c.args[1] === false);
  assert.ok(resolvedCond, "deveria filtrar resolved = false");
});

test("listUrlFailures com includeResolved e sem busca não aplica where", needsMock, async () => {
  resetDb();
  await urlFailures.listUrlFailures({ includeResolved: true });
  const whereArg = callsOf("where")[0].args[0];
  assert.equal(whereArg, undefined);
});

test("listUrlFailures com busca aplica ilike em url e host", needsMock, async () => {
  resetDb();
  await urlFailures.listUrlFailures({ includeResolved: true, q: "example" });
  assert.deepEqual(ilikeTerms.splice(0), ["%example%", "%example%"]);
});

test("listUrlFailures escapa curingas LIKE (%, _, \\) no termo de busca", needsMock, async () => {
  resetDb();
  await urlFailures.listUrlFailures({ includeResolved: true, q: "50%_off\\" });
  // escapeLike prefixa \, % e _ com backslash; depois o termo é envelopado em %...%
  assert.deepEqual(ilikeTerms.splice(0), ["%50\\%\\_off\\\\%", "%50\\%\\_off\\\\%"]);
});

// ─── setUrlFailureResolved / deleteUrlFailure ───

test("setUrlFailureResolved atualiza a flag resolved", needsMock, async () => {
  resetDb();
  await urlFailures.setUrlFailureResolved("abc-123", true);
  assert.deepEqual(callsOf("set")[0].args[0], { resolved: true });
  const whereArg = callsOf("where")[0].args[0] as { op: string; args: unknown[] };
  assert.equal(whereArg.op, "eq");
  assert.equal(whereArg.args[1], "abc-123");
});

test("deleteUrlFailure remove pelo id", needsMock, async () => {
  resetDb();
  await urlFailures.deleteUrlFailure("xyz-789");
  assert.equal(callsOf("delete").length, 1);
  const whereArg = callsOf("where")[0].args[0] as { op: string; args: unknown[] };
  assert.equal(whereArg.op, "eq");
  assert.equal(whereArg.args[1], "xyz-789");
});
