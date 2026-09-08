import assert from "node:assert/strict";
import { test } from "node:test";
import { benefitText, getPlanComparison, getProBenefits } from "../../src/lib/plans/benefits.ts";
import { PLANS, type Plan, type PlanId } from "../../src/server/plans.ts";

const MB = 1024 * 1024;

function makePlan(overrides: {
  maxAssets?: number;
  maxFileSizeBytes?: number;
  maxZipSizeBytes?: number;
  maxConcurrentDownloads?: number;
  downloadsPerDay?: number;
  features?: Partial<Plan["features"]>;
}): Plan {
  return {
    id: "free",
    limits: {
      maxAssets: overrides.maxAssets ?? 10,
      maxFileSizeBytes: overrides.maxFileSizeBytes ?? 50 * MB,
      maxZipSizeBytes: overrides.maxZipSizeBytes ?? 100 * MB,
      maxConcurrentDownloads: overrides.maxConcurrentDownloads ?? 2,
    },
    features: {
      deepCrawl: overrides.features?.deepCrawl ?? false,
      jsRendering: overrides.features?.jsRendering ?? false,
      protectedVideo: overrides.features?.protectedVideo ?? false,
    },
    quota: { downloadsPerDay: overrides.downloadsPerDay ?? 20 },
  };
}

// ─── getProBenefits ───

test("getProBenefits retorna 6 benefícios na ordem esperada com os PLANS reais", () => {
  const benefits = getProBenefits(PLANS);
  assert.equal(benefits.length, 6);
  assert.deepEqual(benefits[0], { label: "200 itens por análise", free: "10" });
  assert.deepEqual(benefits[1], { label: "Downloads diários ilimitados", free: "20/dia" });
  assert.deepEqual(benefits[2], { label: "Busca profunda (varre várias páginas)" });
  assert.deepEqual(benefits[3], { label: "Renderização de páginas com JavaScript" });
  assert.deepEqual(benefits[4], { label: "Arquivos de até 100 MB", free: "50 MB" });
  assert.deepEqual(benefits[5], { label: "ZIP de até 500 MB", free: "100 MB" });
});

test("getProBenefits reflete valores editados pelo admin (não hardcoded)", () => {
  const plans: Record<PlanId, Plan> = {
    free: makePlan({ maxAssets: 5, downloadsPerDay: 3 }),
    pro: makePlan({ maxAssets: 999, maxFileSizeBytes: 250 * MB, maxZipSizeBytes: 1024 * MB }),
  };
  const benefits = getProBenefits(plans);
  assert.equal(benefits[0].label, "999 itens por análise");
  assert.equal(benefits[0].free, "5");
  assert.equal(benefits[1].free, "3/dia");
  assert.equal(benefits[4].label, "Arquivos de até 250 MB");
  assert.equal(benefits[5].label, "ZIP de até 1024 MB");
});

test("getProBenefits arredonda bytes para MB inteiros", () => {
  const plans: Record<PlanId, Plan> = {
    free: makePlan({ maxFileSizeBytes: Math.floor(1.4 * MB) }),
    pro: makePlan({ maxFileSizeBytes: Math.floor(1.5 * MB), maxZipSizeBytes: Math.floor(2.6 * MB) }),
  };
  const benefits = getProBenefits(plans);
  // Math.round(1.5) = 2, Math.round(1.4) = 1, Math.round(2.6) = 3
  assert.equal(benefits[4].label, "Arquivos de até 2 MB");
  assert.equal(benefits[4].free, "1 MB");
  assert.equal(benefits[5].label, "ZIP de até 3 MB");
});

test("getProBenefits marca benefícios Pro-only sem campo free", () => {
  const benefits = getProBenefits(PLANS);
  assert.equal(benefits[2].free, undefined);
  assert.equal(benefits[3].free, undefined);
});

// ─── benefitText ───

test("benefitText inclui comparação com free quando presente", () => {
  assert.equal(benefitText({ label: "200 itens", free: "10" }), "200 itens (free: 10)");
});

test("benefitText retorna apenas o label quando não há free", () => {
  assert.equal(benefitText({ label: "Busca profunda" }), "Busca profunda");
});

test("benefitText trata string vazia de free como ausente", () => {
  assert.equal(benefitText({ label: "Algo", free: "" }), "Algo");
});

// ─── getPlanComparison ───

test("getPlanComparison retorna 8 linhas com os PLANS reais", () => {
  const rows = getPlanComparison(PLANS);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], { feature: "Itens por análise", free: "10", pro: "200" });
  assert.deepEqual(rows[1], { feature: "Downloads por dia", free: "20", pro: "Ilimitado" });
  assert.deepEqual(rows[2], { feature: "Tamanho máximo por arquivo", free: "50 MB", pro: "100 MB" });
  assert.deepEqual(rows[3], { feature: "Tamanho máximo do ZIP", free: "100 MB", pro: "500 MB" });
  assert.deepEqual(rows[4], { feature: "Downloads simultâneos", free: "2", pro: "8" });
});

test("getPlanComparison expõe features booleanas cruas (renderizadas como check/dash)", () => {
  const rows = getPlanComparison(PLANS);
  assert.deepEqual(rows[5], { feature: "Busca profunda (varre várias páginas)", free: false, pro: true });
  assert.deepEqual(rows[6], { feature: "Renderização de páginas com JavaScript", free: false, pro: true });
  assert.deepEqual(rows[7], { feature: "Vídeos protegidos", free: false, pro: true });
});

test("getPlanComparison sempre mostra Pro como Ilimitado em downloads por dia", () => {
  // Mesmo se o plano pro tiver um número finito de quota, a linha mostra "Ilimitado".
  const plans: Record<PlanId, Plan> = {
    free: makePlan({ downloadsPerDay: 7 }),
    pro: makePlan({ downloadsPerDay: 500 }),
  };
  const rows = getPlanComparison(plans);
  assert.deepEqual(rows[1], { feature: "Downloads por dia", free: "7", pro: "Ilimitado" });
});

test("getPlanComparison reflete features invertidas (pro sem feature, free com)", () => {
  const plans: Record<PlanId, Plan> = {
    free: makePlan({ features: { deepCrawl: true } }),
    pro: makePlan({ features: { deepCrawl: false } }),
  };
  const rows = getPlanComparison(plans);
  assert.deepEqual(rows[5], { feature: "Busca profunda (varre várias páginas)", free: true, pro: false });
});
