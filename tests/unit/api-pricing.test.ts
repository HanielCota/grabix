import assert from "node:assert/strict";
import { mock, test } from "node:test";

// Testa a rota GET /api/pricing (src/app/api/pricing/route.ts) com
// @/server/plans-config mockado. Requer --experimental-test-module-mocks.
const canMockModules = typeof (mock as unknown as { module?: unknown }).module === "function";
const needsMock = { skip: !canMockModules && "requer node --experimental-test-module-mocks" };

let impl: { amountCents: number; label: string } = { amountCents: 1990, label: "R$ 19,90/mês" };
let implError: Error | null = null;

if (canMockModules) {
  mock.module("@/server/plans-config", {
    namedExports: {
      getEffectivePricing: () => {
        if (implError) return Promise.reject(implError);
        return Promise.resolve(impl);
      },
    },
  });
}

async function importRoute() {
  return import("../../src/app/api/pricing/route.ts");
}

// ─── Caminho feliz ───

test("GET /api/pricing: retorna label e valor em centavos", needsMock, async () => {
  const { GET } = await importRoute();
  impl = { amountCents: 1990, label: "R$ 19,90/mês" };
  implError = null;
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { proPriceLabel: "R$ 19,90/mês", proAmountCents: 1990 });
});

test("GET /api/pricing: responde com Cache-Control no-store", needsMock, async () => {
  const { GET } = await importRoute();
  impl = { amountCents: 1990, label: "R$ 19,90/mês" };
  implError = null;
  const res = await GET();
  assert.equal(res.headers.get("cache-control"), "no-store, must-revalidate");
});

test("GET /api/pricing: rota é force-dynamic", needsMock, async () => {
  const route = await importRoute();
  assert.equal(route.dynamic, "force-dynamic");
});

test("GET /api/pricing: preço customizado do admin é refletido", needsMock, async () => {
  const { GET } = await importRoute();
  impl = { amountCents: 2990, label: "R$ 29,90/mês" };
  implError = null;
  const body = await (await GET()).json();
  assert.deepEqual(body, { proPriceLabel: "R$ 29,90/mês", proAmountCents: 2990 });
});

// ─── Erros ───

test("GET /api/pricing: erro na camada de dados propaga (rota não trata)", needsMock, async () => {
  const { GET } = await importRoute();
  implError = new Error("db down");
  await assert.rejects(() => GET(), /db down/);
});
