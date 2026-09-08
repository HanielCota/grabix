import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Public /pricing page, signed out. The plan data comes from GET /api/plans,
// which falls back to the code defaults when the DB is unavailable, so the
// page renders deterministically in the test environment.

test.describe("pricing page (signed out)", () => {
  test("shows the hero heading and the plan pitch", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: /analise mais páginas e monte zips maiores/i })).toBeVisible();
    await expect(page.getByText(/o plano grátis não exige pagamento/i)).toBeVisible();
  });

  test("renders the Free and Pro plan cards with CTAs", async ({ page }) => {
    await page.goto("/pricing");

    const plansSection = page.getByRole("region", { name: "Planos" });
    await expect(plansSection.getByRole("heading", { name: "Grátis", exact: true })).toBeVisible();
    await expect(plansSection.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();

    // Free card: fixed R$ 0 price and client-side CTA that goes back home.
    await expect(plansSection.getByText("R$ 0", { exact: true })).toBeVisible();
    await expect(plansSection.getByRole("button", { name: /começar gratuitamente/i })).toBeVisible();

    // Pro card: signed-out visitors are sent to Google sign-in.
    await expect(plansSection.getByText(/pagamento único · 30 dias de acesso/i).first()).toBeVisible();
    await expect(plansSection.getByRole("button", { name: /entrar para assinar/i })).toBeVisible();
    await expect(plansSection.getByText(/mais escolhido/i)).toBeVisible();
  });

  test("shows the Free vs Pro comparison table", async ({ page }) => {
    await page.goto("/pricing");
    await expect(
      page.getByRole("heading", { name: /capacidade para o trabalho que você precisa fazer agora/i }),
    ).toBeVisible();

    // The table hydrates from /api/plans; wait for the column headers.
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Recurso" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Grátis" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Pro" })).toBeVisible();
    // At least one comparison row must be present once the plans load.
    await expect(table.getByRole("row").nth(1)).toBeVisible();
  });

  test("shows trust signals, FAQ and the final CTA", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText(/pix ou cartão via mercado pago/i)).toBeVisible();
    await expect(page.getByText(/sem renovação automática/i).first()).toBeVisible();

    await expect(page.getByRole("heading", { name: /perguntas antes de escolher/i })).toBeVisible();
    await expect(page.getByText(/posso usar o grabix gratuitamente/i)).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /comece grátis. faça upgrade quando fizer sentido/i }),
    ).toBeVisible();
  });

  test("has no serious or critical accessibility violations", async ({ page }) => {
    await page.goto("/pricing");
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Wait for the plan data to hydrate so the comparison table is rendered.
    await page.getByRole("table").getByRole("columnheader", { name: "Pro" }).waitFor();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");

    expect(blocking.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
  });
});
