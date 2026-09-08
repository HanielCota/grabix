import assert from "node:assert/strict";
import { mock, test } from "node:test";

// Requer --experimental-test-module-mocks para o mock de "@/server/db" e "drizzle-orm".
const MODULE_MOCK_AVAILABLE = typeof (mock as unknown as { module?: unknown }).module === "function";

// ─── Fake de DB: proxy thenable com FILA de resultados ───
// Cada `await` no chain consome o próximo item da fila; fila vazia → dbDefault.

type DbCall = { method: string; args: unknown[] };
const dbCalls: DbCall[] = [];
let dbQueue: unknown[] = [];
let dbDefault: unknown = [];

function resetDb(queue: unknown[] = [], defaultResult: unknown = []) {
  dbCalls.length = 0;
  dbQueue = [...queue];
  dbDefault = defaultResult;
}

function makeChain(): unknown {
  const chain: unknown = new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => {
          resolve(dbQueue.length > 0 ? dbQueue.shift() : dbDefault);
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

// drizzle-orm mockado com descritores inspecionáveis
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
};

if (MODULE_MOCK_AVAILABLE) {
  // @types/node (22) ainda não tipa a opção `exports` do Node 26 (antiga `namedExports`)
  const opts = { exports: drizzleMock } as Parameters<typeof mock.module>[1];
  mock.module("drizzle-orm", opts);
  mock.module("@/server/db", { exports: { getDb: () => makeChain() } } as typeof opts);
}

const history = await import("../../src/server/analysis-history.ts");
const needsMock = { skip: !MODULE_MOCK_AVAILABLE && "requer --experimental-test-module-mocks" };

function callsOf(method: string): DbCall[] {
  return dbCalls.filter((c) => c.method === method);
}

// ─── Fixtures ───

const IMAGE_ASSET = {
  url: "https://cdn.example.com/foto.jpg",
  type: "IMAGE",
  fileName: "foto.jpg",
  extension: "jpg",
  sourceTag: "img",
};

const VIDEO_ASSET = {
  url: "https://cdn.example.com/clipe.mp4",
  type: "VIDEO",
  fileName: "clipe.mp4",
  extension: "mp4",
  sourceTag: "video",
};

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://www.example.com/galeria",
    totalFound: 3,
    assets: [
      IMAGE_ASSET,
      VIDEO_ASSET,
      { ...IMAGE_ASSET, url: "https://cdn.example.com/foto2.jpg", fileName: "foto2.jpg" },
    ],
    pagesScanned: 1,
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    userId: "u1",
    sourceUrl: "https://example.com/page",
    domain: "example.com",
    deepCrawl: false,
    totalFound: 2,
    imageCount: 1,
    videoCount: 1,
    pagesScanned: 1,
    lockedCount: 0,
    assets: JSON.stringify([IMAGE_ASSET, VIDEO_ASSET]),
    selectedUrls: "[]",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

// ─── saveCompletedAnalysis ───

test("saveCompletedAnalysis conta imagens e vídeos e serializa assets", needsMock, async () => {
  resetDb([[{ id: "saved-1" }]]);
  const saved = await history.saveCompletedAnalysis("u1", makeResult() as never, false);

  assert.deepEqual(saved, { id: "saved-1" });
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal(values.userId, "u1");
  assert.equal(values.sourceUrl, "https://www.example.com/galeria");
  assert.equal(values.domain, "example.com"); // www. removido
  assert.equal(values.deepCrawl, false);
  assert.equal(values.totalFound, 3);
  assert.equal(values.imageCount, 2);
  assert.equal(values.videoCount, 1); // total - imagens
  assert.equal(values.pagesScanned, 1);
  assert.equal(values.lockedCount, 0); // ?? 0 quando ausente
  assert.equal(typeof values.assets, "string");
  assert.equal(JSON.parse(values.assets as string).length, 3);
});

test("saveCompletedAnalysis usa lockedCount quando presente e repassa deepCrawl", needsMock, async () => {
  resetDb([[{ id: "saved-2" }]]);
  await history.saveCompletedAnalysis("u1", makeResult({ lockedCount: 7 }) as never, true);
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal(values.lockedCount, 7);
  assert.equal(values.deepCrawl, true);
});

test("saveCompletedAnalysis com URL malformada usa a própria string como domínio", needsMock, async () => {
  resetDb([[{ id: "saved-3" }]]);
  await history.saveCompletedAnalysis("u1", makeResult({ url: "não-é-url" }) as never, false);
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal(values.domain, "não-é-url");
});

test("saveCompletedAnalysis sem assets conta zero de ambos os tipos", needsMock, async () => {
  resetDb([[{ id: "saved-4" }]]);
  await history.saveCompletedAnalysis("u1", makeResult({ assets: [], totalFound: 0 }) as never, false);
  const values = callsOf("values")[0].args[0] as Record<string, unknown>;
  assert.equal(values.imageCount, 0);
  assert.equal(values.videoCount, 0);
});

// ─── listSavedAnalyses ───

test("listSavedAnalyses sem busca filtra só por usuário (where simples), limit 50", needsMock, async () => {
  resetDb([[makeRow()]]);
  const rows = await history.listSavedAnalyses("u1");
  assert.equal(rows.length, 1);

  const whereArg = callsOf("where")[0].args[0] as { op: string; args: unknown[] };
  assert.equal(whereArg.op, "eq"); // sem and/or quando não há busca
  assert.equal(whereArg.args[1], "u1");
  assert.equal(callsOf("limit")[0].args[0], 50);
  assert.equal(callsOf("orderBy")[0].args.length, 1);
});

test("listSavedAnalyses com busca aplica ilike (trimado) em domínio e URL", needsMock, async () => {
  resetDb([[]]);
  await history.listSavedAnalyses("u1", "  exemplo  ");
  const whereArg = callsOf("where")[0].args[0] as { op: string };
  assert.equal(whereArg.op, "and");
  assert.deepEqual(ilikeTerms.splice(0), ["%exemplo%", "%exemplo%"]);
});

test("listSavedAnalyses com busca vazia/só espaços não aplica filtro de texto", needsMock, async () => {
  for (const q of ["", "   "]) {
    resetDb([[]]);
    await history.listSavedAnalyses("u1", q);
    const whereArg = callsOf("where")[0].args[0] as { op: string };
    assert.equal(whereArg.op, "eq", `q=${JSON.stringify(q)}`);
  }
});

test("listSavedAnalyses calcula selectedCount a partir de selectedUrls", needsMock, async () => {
  resetDb([
    [
      makeRow({ id: "a", selectedUrls: JSON.stringify(["https://x/1.jpg", "https://x/2.jpg"]) }),
      makeRow({ id: "b", selectedUrls: "json inválido{" }),
      makeRow({ id: "c", selectedUrls: JSON.stringify(["https://x/1.jpg", 42, null]) }),
      makeRow({ id: "d", selectedUrls: JSON.stringify({ nao: "array" }) }),
    ],
  ]);
  const rows = await history.listSavedAnalyses("u1");
  assert.deepEqual(
    rows.map((r) => [r.id, r.selectedCount]),
    [
      ["a", 2],
      ["b", 0], // JSON inválido → 0
      ["c", 1], // não-strings filtrados
      ["d", 0], // não-array → 0
    ],
  );
});

// ─── getSavedAnalysis ───

test("getSavedAnalysis retorna null quando a row não existe", needsMock, async () => {
  resetDb([[]]);
  assert.equal(await history.getSavedAnalysis("u1", "inexistente"), null);
});

test("getSavedAnalysis retorna null quando assets não é JSON válido", needsMock, async () => {
  resetDb([[makeRow({ assets: "{quebrado" })]]);
  assert.equal(await history.getSavedAnalysis("u1", "a1"), null);
});

test("getSavedAnalysis retorna null quando os dados não passam no schema", needsMock, async () => {
  resetDb([[makeRow({ totalFound: -5 })]]); // totalFound negativo viola o schema
  assert.equal(await history.getSavedAnalysis("u1", "a1"), null);
});

test("getSavedAnalysis retorna null quando a URL salva não é pública/válida", needsMock, async () => {
  resetDb([[makeRow({ sourceUrl: "javascript:alert(1)" })]]);
  assert.equal(await history.getSavedAnalysis("u1", "a1"), null);
});

test("getSavedAnalysis retorna a row com result validado e selectedUrls parseado", needsMock, async () => {
  const selected = ["https://cdn.example.com/foto.jpg"];
  resetDb([[makeRow({ selectedUrls: JSON.stringify(selected), lockedCount: 4, pagesScanned: 3 })]]);
  const row = await history.getSavedAnalysis("u1", "a1");
  assert.ok(row);
  assert.equal(row.id, "a1");
  assert.equal(row.result.totalFound, 2);
  assert.equal(row.result.assets.length, 2);
  assert.equal(row.result.pagesScanned, 3);
  assert.equal(row.result.lockedCount, 4);
  assert.deepEqual(row.selectedUrls, selected);
});

test("getSavedAnalysis: lockedCount 0 e pagesScanned null viram undefined no result", needsMock, async () => {
  resetDb([[makeRow({ lockedCount: 0, pagesScanned: null })]]);
  const row = await history.getSavedAnalysis("u1", "a1");
  assert.ok(row);
  assert.equal(row.result.lockedCount, undefined);
  assert.equal(row.result.pagesScanned, undefined);
});

// ─── updateSavedAnalysisSelection ───

test("updateSavedAnalysisSelection retorna null quando a análise não existe", needsMock, async () => {
  resetDb([[]]); // getSavedAnalysis → sem row
  assert.equal(await history.updateSavedAnalysisSelection("u1", "a1", ["https://x/1.jpg"]), null);
});

test("updateSavedAnalysisSelection mantém só URLs presentes nos assets, na ordem dos assets", needsMock, async () => {
  resetDb([
    [makeRow()], // getSavedAnalysis
    [{ id: "a1", selectedUrls: JSON.stringify([IMAGE_ASSET.url]) }], // update returning
  ]);
  const updated = await history.updateSavedAnalysisSelection("u1", "a1", [
    "https://nao-existe.com/x.jpg",
    IMAGE_ASSET.url,
  ]);
  assert.deepEqual(updated, [IMAGE_ASSET.url]);

  const setArg = callsOf("set")[0].args[0] as { selectedUrls: string; updatedAt: Date };
  assert.deepEqual(JSON.parse(setArg.selectedUrls), [IMAGE_ASSET.url]);
  assert.ok(setArg.updatedAt instanceof Date);
});

test("updateSavedAnalysisSelection com seleção vazia salva array vazio", needsMock, async () => {
  resetDb([[makeRow()], [{ id: "a1", selectedUrls: "[]" }]]);
  const updated = await history.updateSavedAnalysisSelection("u1", "a1", []);
  assert.deepEqual(updated, []);
});

test("updateSavedAnalysisSelection retorna null quando o update não retorna row", needsMock, async () => {
  resetDb([[makeRow()], []]); // returning vazio (race: deletado entre select e update)
  assert.equal(await history.updateSavedAnalysisSelection("u1", "a1", [IMAGE_ASSET.url]), null);
});

// ─── deleteSavedAnalysis ───

test("deleteSavedAnalysis retorna true quando removeu a row", needsMock, async () => {
  resetDb([[{ id: "a1" }]]);
  assert.equal(await history.deleteSavedAnalysis("u1", "a1"), true);
});

test("deleteSavedAnalysis retorna false quando a row não existia", needsMock, async () => {
  resetDb([[]]);
  assert.equal(await history.deleteSavedAnalysis("u1", "a1"), false);
});
