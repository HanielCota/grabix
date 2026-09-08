import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE_PLAN, getPlan, isPlanId, PLANS, PRICING, planFromJson, planToJson } from "../../src/server/plans.ts";

const MB = 1024 * 1024;

// ─── PLANS / FREE_PLAN ───

test("PLANS define exatamente os planos free e pro", () => {
  assert.deepEqual(Object.keys(PLANS).sort(), ["free", "pro"]);
  assert.equal(PLANS.free.id, "free");
  assert.equal(PLANS.pro.id, "pro");
});

test("FREE_PLAN é exatamente PLANS.free", () => {
  assert.equal(FREE_PLAN, PLANS.free);
});

test("plano free tem os limites esperados e features desligadas", () => {
  assert.deepEqual(PLANS.free.limits, {
    maxAssets: 10,
    maxFileSizeBytes: 50 * MB,
    maxZipSizeBytes: 100 * MB,
    maxConcurrentDownloads: 2,
  });
  assert.deepEqual(PLANS.free.features, { deepCrawl: false, jsRendering: false, protectedVideo: false });
  assert.equal(PLANS.free.quota.downloadsPerDay, 20);
});

test("plano pro tem limites maiores, features ligadas e quota ilimitada", () => {
  assert.deepEqual(PLANS.pro.limits, {
    maxAssets: 200,
    maxFileSizeBytes: 100 * MB,
    maxZipSizeBytes: 500 * MB,
    maxConcurrentDownloads: 8,
  });
  assert.deepEqual(PLANS.pro.features, { deepCrawl: true, jsRendering: true, protectedVideo: true });
  assert.equal(PLANS.pro.quota.downloadsPerDay, Number.POSITIVE_INFINITY);
});

// ─── getPlan ───

test("getPlan resolve ids válidos", () => {
  assert.equal(getPlan("free"), PLANS.free);
  assert.equal(getPlan("pro"), PLANS.pro);
});

test("getPlan cai no plano free para null/undefined", () => {
  assert.equal(getPlan(null), PLANS.free);
  assert.equal(getPlan(undefined), PLANS.free);
});

test("getPlan cai no plano free para ids desconhecidos", () => {
  for (const id of ["", "FREE", "Pro", "enterprise", "free ", " pro", "0"]) {
    assert.equal(getPlan(id), PLANS.free, `id=${JSON.stringify(id)}`);
  }
});

// ─── isPlanId ───

test("isPlanId aceita apenas free e pro exatos", () => {
  assert.equal(isPlanId("free"), true);
  assert.equal(isPlanId("pro"), true);
});

test("isPlanId rejeita qualquer outro valor", () => {
  for (const value of ["FREE", "Pro", "", "free ", null, undefined, 0, 1, true, {}, [], ["free"]]) {
    assert.equal(isPlanId(value), false, `value=${JSON.stringify(value)}`);
  }
});

// ─── planToJson ───

test("planToJson serializa o plano free com quota numérica", () => {
  assert.deepEqual(planToJson(PLANS.free), {
    maxAssets: 10,
    maxFileSizeBytes: 50 * MB,
    maxZipSizeBytes: 100 * MB,
    maxConcurrentDownloads: 2,
    deepCrawl: false,
    jsRendering: false,
    protectedVideo: false,
    downloadsPerDay: 20,
  });
});

test("planToJson converte quota infinita (pro) para -1", () => {
  const snapshot = planToJson(PLANS.pro);
  assert.equal(snapshot.downloadsPerDay, -1);
  assert.equal(snapshot.deepCrawl, true);
  assert.equal(snapshot.jsRendering, true);
  assert.equal(snapshot.protectedVideo, true);
});

// ─── planFromJson ───

test("planFromJson reconstrói um plano completo a partir do snapshot", () => {
  const plan = planFromJson("pro", {
    maxAssets: 5,
    maxFileSizeBytes: 10,
    maxZipSizeBytes: 20,
    maxConcurrentDownloads: 1,
    deepCrawl: true,
    jsRendering: false,
    protectedVideo: true,
    downloadsPerDay: 42,
  });
  assert.equal(plan.id, "pro");
  assert.deepEqual(plan.limits, {
    maxAssets: 5,
    maxFileSizeBytes: 10,
    maxZipSizeBytes: 20,
    maxConcurrentDownloads: 1,
  });
  assert.deepEqual(plan.features, { deepCrawl: true, jsRendering: false, protectedVideo: true });
  assert.equal(plan.quota.downloadsPerDay, 42);
});

test("planFromJson converte downloadsPerDay negativo de volta para infinito", () => {
  const plan = planFromJson("free", { ...planToJson(PLANS.pro), downloadsPerDay: -1 });
  assert.equal(plan.quota.downloadsPerDay, Number.POSITIVE_INFINITY);
});

test("planFromJson: downloadsPerDay 0 não vira infinito (apenas negativos viram)", () => {
  const plan = planFromJson("free", { ...planToJson(PLANS.free), downloadsPerDay: 0 });
  assert.equal(plan.quota.downloadsPerDay, 0);
});

test("round-trip planToJson → planFromJson preserva o plano free", () => {
  const restored = planFromJson("free", planToJson(PLANS.free));
  assert.deepEqual(restored, PLANS.free);
});

test("round-trip planToJson → planFromJson preserva o plano pro (incluindo infinito)", () => {
  const restored = planFromJson("pro", planToJson(PLANS.pro));
  assert.deepEqual(restored, PLANS.pro);
});

// ─── PRICING ───

test("PRICING usa o label padrão quando a env não está definida", () => {
  // Sem NEXT_PUBLIC_PRO_PRICE_LABEL no ambiente de teste, cai no fallback.
  if (process.env.NEXT_PUBLIC_PRO_PRICE_LABEL === undefined) {
    assert.equal(PRICING.proPriceLabel, "R$ 19,90/mês");
  } else {
    assert.equal(PRICING.proPriceLabel, process.env.NEXT_PUBLIC_PRO_PRICE_LABEL);
  }
});
