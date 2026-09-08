import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { PLANS } from "../../src/server/plans.ts";

// Requer --experimental-test-module-mocks para o mock de "@/server/db".
const MODULE_MOCK_AVAILABLE = typeof (mock as unknown as { module?: unknown }).module === "function";

type DbCall = { method: string; args: unknown[] };
const dbCalls: DbCall[] = [];
let dbRows: unknown[] = [];
let dbError: Error | null = null;

function resetDb(rows: unknown[] = []) {
  dbCalls.length = 0;
  dbRows = rows;
  dbError = null;
}

function makeChain(): unknown {
  const chain: unknown = new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          if (dbError) reject(dbError);
          else resolve(dbRows);
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

if (MODULE_MOCK_AVAILABLE) {
  // @types/node (22) ainda não tipa a opção `exports` do Node 26 (antiga `namedExports`)
  mock.module("@/server/db", { exports: { getDb: () => makeChain() } } as Parameters<typeof mock.module>[1]);
}

const plansConfig = await import("../../src/server/plans-config.ts");
const needsMock = { skip: !MODULE_MOCK_AVAILABLE && "requer --experimental-test-module-mocks" };

const ENV_KEYS = ["MP_PRO_AMOUNT", "NEXT_PUBLIC_PRO_PRICE_LABEL"] as const;

function withEnv<T>(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function dbRow(overrides: Record<string, unknown>) {
  return {
    id: "pro",
    maxAssets: 999,
    maxFileSizeBytes: 1234,
    maxZipSizeBytes: 5678,
    maxConcurrentDownloads: 9,
    deepCrawl: false,
    jsRendering: true,
    protectedVideo: false,
    downloadsPerDay: 100,
    priceAmountCents: null,
    priceLabel: null,
    ...overrides,
  };
}

function selectCount(): number {
  return dbCalls.filter((c) => c.method === "select").length;
}

// ─── Fallback sem DB ───

test("loadConfig usa os defaults do código quando o DB falha (com warning)", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  dbError = new Error("db down");
  const warn = mock.method(console, "warn", () => {});
  try {
    const cfg = await plansConfig.loadConfig(true);
    assert.equal(cfg.plans.free, PLANS.free);
    assert.equal(cfg.plans.pro, PLANS.pro);
    assert.equal(warn.mock.callCount(), 1);
  } finally {
    warn.mock.restore();
  }
});

test("fallback de pricing: defaults R$ 19,90 (1990 centavos)", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  dbError = new Error("db down");
  await withEnv({ MP_PRO_AMOUNT: undefined, NEXT_PUBLIC_PRO_PRICE_LABEL: undefined }, async () => {
    const cfg = await plansConfig.loadConfig(true);
    assert.deepEqual(cfg.pricing, { amountCents: 1990, label: "R$ 19,90/mês" });
  });
});

test("fallback de pricing: MP_PRO_AMOUNT válido é convertido para centavos", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  dbError = new Error("db down");
  await withEnv({ MP_PRO_AMOUNT: "29.90", NEXT_PUBLIC_PRO_PRICE_LABEL: "R$ 29,90/mês" }, async () => {
    const cfg = await plansConfig.loadConfig(true);
    assert.deepEqual(cfg.pricing, { amountCents: 2990, label: "R$ 29,90/mês" });
  });
});

test("fallback de pricing: MP_PRO_AMOUNT inválido cai em 19.90", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  dbError = new Error("db down");
  await withEnv({ MP_PRO_AMOUNT: "abc", NEXT_PUBLIC_PRO_PRICE_LABEL: undefined }, async () => {
    const cfg = await plansConfig.loadConfig(true);
    assert.equal(cfg.pricing.amountCents, 1990);
  });
});

test("fallback de pricing: MP_PRO_AMOUNT com 3 casas decimais arredonda", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  dbError = new Error("db down");
  await withEnv({ MP_PRO_AMOUNT: "19.999", NEXT_PUBLIC_PRO_PRICE_LABEL: undefined }, async () => {
    const cfg = await plansConfig.loadConfig(true);
    assert.equal(cfg.pricing.amountCents, 2000); // Math.round(1999.9)
  });
});

// ─── Overrides do DB ───

test("rows do DB sobrescrevem os planos do código", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "pro" })]);
  const cfg = await plansConfig.loadConfig(true);
  assert.equal(cfg.plans.free, PLANS.free); // free sem row → default
  assert.deepEqual(cfg.plans.pro, {
    id: "pro",
    limits: { maxAssets: 999, maxFileSizeBytes: 1234, maxZipSizeBytes: 5678, maxConcurrentDownloads: 9 },
    features: { deepCrawl: false, jsRendering: true, protectedVideo: false },
    quota: { downloadsPerDay: 100 },
  });
});

test("row do free também sobrescreve o default", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "free", maxAssets: 3, downloadsPerDay: 5 })]);
  const cfg = await plansConfig.loadConfig(true);
  assert.equal(cfg.plans.free.limits.maxAssets, 3);
  assert.equal(cfg.plans.free.quota.downloadsPerDay, 5);
});

test("downloadsPerDay negativo no DB vira infinito", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "pro", downloadsPerDay: -1 })]);
  const cfg = await plansConfig.loadConfig(true);
  assert.equal(cfg.plans.pro.quota.downloadsPerDay, Number.POSITIVE_INFINITY);
});

test("downloadsPerDay 0 no DB permanece 0 (não vira infinito)", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "pro", downloadsPerDay: 0 })]);
  const cfg = await plansConfig.loadConfig(true);
  assert.equal(cfg.plans.pro.quota.downloadsPerDay, 0);
});

test("row com id desconhecido é ignorada", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "enterprise" })]);
  const cfg = await plansConfig.loadConfig(true);
  assert.equal(cfg.plans.free, PLANS.free);
  assert.equal(cfg.plans.pro, PLANS.pro);
  assert.equal(Object.keys(cfg.plans).length, 2);
});

test("pricing vem do DB quando o pro tem priceAmountCents", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "pro", priceAmountCents: 4990, priceLabel: "R$ 49,90/mês" })]);
  const cfg = await plansConfig.loadConfig(true);
  assert.deepEqual(cfg.pricing, { amountCents: 4990, label: "R$ 49,90/mês" });
});

test("priceAmountCents do DB sem priceLabel mantém o label do código", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "pro", priceAmountCents: 4990, priceLabel: null })]);
  await withEnv({ NEXT_PUBLIC_PRO_PRICE_LABEL: undefined }, async () => {
    const cfg = await plansConfig.loadConfig(true);
    assert.deepEqual(cfg.pricing, { amountCents: 4990, label: "R$ 19,90/mês" });
  });
});

test("priceAmountCents do plano free não altera o pricing", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "free", priceAmountCents: 100, priceLabel: "Grátis" })]);
  await withEnv({ MP_PRO_AMOUNT: undefined, NEXT_PUBLIC_PRO_PRICE_LABEL: undefined }, async () => {
    const cfg = await plansConfig.loadConfig(true);
    assert.deepEqual(cfg.pricing, { amountCents: 1990, label: "R$ 19,90/mês" });
  });
});

// ─── Cache / TTL ───

test("segunda chamada dentro do TTL não consulta o DB de novo", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  await plansConfig.loadConfig();
  await plansConfig.loadConfig();
  assert.equal(selectCount(), 1);
});

test("loadConfig(true) força nova consulta mesmo dentro do TTL", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  await plansConfig.loadConfig();
  await plansConfig.loadConfig(true);
  assert.equal(selectCount(), 2);
});

test("invalidatePlansCache força nova consulta", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  await plansConfig.loadConfig();
  plansConfig.invalidatePlansCache();
  await plansConfig.loadConfig();
  assert.equal(selectCount(), 2);
});

test("resultado cacheado é o mesmo objeto (sem re-parse)", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  const first = await plansConfig.loadConfig();
  const second = await plansConfig.loadConfig();
  assert.equal(first, second);
});

// ─── Getters ───

test("getEffectivePlan retorna o plano efetivo por id", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "pro", maxAssets: 777 })]);
  assert.equal((await plansConfig.getEffectivePlan("pro")).limits.maxAssets, 777);
  assert.equal(await plansConfig.getEffectivePlan("free"), PLANS.free);
});

test("getEffectivePlan cai no free para id desconhecido em runtime", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  const plan = await plansConfig.getEffectivePlan("enterprise" as "pro");
  assert.equal(plan, PLANS.free);
});

test("getEffectivePricing retorna o pricing efetivo", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb([dbRow({ id: "pro", priceAmountCents: 2990, priceLabel: "R$ 29,90/mês" })]);
  assert.deepEqual(await plansConfig.getEffectivePricing(), { amountCents: 2990, label: "R$ 29,90/mês" });
});

test("getEffectivePlans retorna planos e pricing juntos", needsMock, async () => {
  plansConfig.invalidatePlansCache();
  resetDb();
  const result = await plansConfig.getEffectivePlans();
  assert.ok(result.plans.free);
  assert.ok(result.plans.pro);
  assert.ok(typeof result.pricing.amountCents === "number");
  assert.ok(typeof result.pricing.label === "string");
});
