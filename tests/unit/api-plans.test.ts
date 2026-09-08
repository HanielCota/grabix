import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { Plan } from "../../src/server/plans.ts";

// Testa a rota GET /api/plans (src/app/api/plans/route.ts). A camada de dados
// (@/server/plans-config) é mockada; @/server/plans (planToJson) é real por ser
// puro. Requer --experimental-test-module-mocks.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const needsMock = { skip: !canMockModules && "requer node --experimental-test-module-mocks" };

type EffectivePlans = {
  plans: { free: Plan; pro: Plan };
  pricing: { amountCents: number; label: string };
};

let impl: EffectivePlans | null = null;
let implError: Error | null = null;

if (canMockModules) {
  mock.module("@/server/plans-config", {
    namedExports: {
      getEffectivePlans: () => {
        if (implError) return Promise.reject(implError);
        return Promise.resolve(impl);
      },
    },
  });
}

async function importRoute() {
  return import("../../src/app/api/plans/route.ts");
}

function makePlan(id: "free" | "pro", downloadsPerDay: number): Plan {
  return {
    id,
    limits: { maxAssets: 10, maxFileSizeBytes: 1024, maxZipSizeBytes: 2048, maxConcurrentDownloads: 2 },
    features: { deepCrawl: id === "pro", jsRendering: id === "pro", protectedVideo: false },
    quota: { downloadsPerDay },
  };
}

function reset(overrides?: EffectivePlans) {
  implError = null;
  impl = overrides ?? {
    plans: { free: makePlan("free", 20), pro: makePlan("pro", Number.POSITIVE_INFINITY) },
    pricing: { amountCents: 1990, label: "R$ 19,90/mês" },
  };
}

// ─── Caminho feliz ───

test("GET /api/plans: retorna planos serializados e pricing", needsMock, async () => {
  const { GET } = await importRoute();
  reset();
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.free, {
    maxAssets: 10,
    maxFileSizeBytes: 1024,
    maxZipSizeBytes: 2048,
    maxConcurrentDownloads: 2,
    deepCrawl: false,
    jsRendering: false,
    protectedVideo: false,
    downloadsPerDay: 20,
  });
  assert.deepEqual(body.pricing, { amountCents: 1990, label: "R$ 19,90/mês" });
});

test("GET /api/plans: downloadsPerDay infinito é serializado como -1", needsMock, async () => {
  const { GET } = await importRoute();
  reset();
  const body = await (await GET()).json();
  assert.equal(body.pro.downloadsPerDay, -1);
});

test("GET /api/plans: responde com Cache-Control no-store", needsMock, async () => {
  const { GET } = await importRoute();
  reset();
  const res = await GET();
  assert.equal(res.headers.get("cache-control"), "no-store, must-revalidate");
});

test("GET /api/plans: rota é force-dynamic", needsMock, async () => {
  const route = await importRoute();
  assert.equal(route.dynamic, "force-dynamic");
});

// ─── Erros / bordas ───

test("GET /api/plans: pricing customizado do admin é repassado sem alteração", needsMock, async () => {
  const { GET } = await importRoute();
  reset({
    plans: { free: makePlan("free", 5), pro: makePlan("pro", 100) },
    pricing: { amountCents: 4990, label: "R$ 49,90/mês" },
  });
  const body = await (await GET()).json();
  assert.deepEqual(body.pricing, { amountCents: 4990, label: "R$ 49,90/mês" });
  assert.equal(body.free.downloadsPerDay, 5);
  assert.equal(body.pro.downloadsPerDay, 100); // finito permanece finito
});

test("GET /api/plans: erro na camada de dados propaga (rota não trata)", needsMock, async () => {
  const { GET } = await importRoute();
  reset();
  implError = new Error("config indisponível");
  await assert.rejects(() => GET(), /config indisponível/);
});
