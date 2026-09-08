import { expect, test } from "@playwright/test";

// Header/footer navigation for a signed-out visitor (desktop viewport, so the
// inline nav is visible). Note: the header has no /sign-in link — signing in is
// the "Começar grátis" button, which calls next-auth's signIn("google") via JS
// and would leave the app for Google OAuth, so it is not covered here.

test.describe("site header navigation (signed out)", () => {
  test("the Preços nav link goes from home to /pricing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Preços" }).click();

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole("heading", { name: /analise mais páginas/i })).toBeVisible();
    // The active route is announced to assistive tech.
    await expect(
      page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Preços" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("the logo link returns from /pricing to home", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("link", { name: "Grabix - início" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: /encontre todas as mídias/i })).toBeVisible();
  });

  test("the section nav links point back to home anchors from any route", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Como funciona" }).click();

    await expect(page).toHaveURL(/\/#como-funciona$/);
    await expect(page.locator("#como-funciona")).toBeVisible();
  });

  test("the home footer links to the pricing page", async ({ page }) => {
    await page.goto("/");
    // The footer sits inside <main>, so it is not a contentinfo landmark.
    await page.locator("footer").getByRole("link", { name: "Planos" }).click();

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole("heading", { name: /analise mais páginas/i })).toBeVisible();
  });

  test("the sign-in page is reachable directly and renders the OAuth entry point", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: /entre no grabix/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /continuar com google/i })).toBeVisible();
  });
});
