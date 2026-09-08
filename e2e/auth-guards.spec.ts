import { expect, test } from "@playwright/test";

// Behaviour of auth-gated pages for a signed-out visitor. Verified against the
// running app (no DB/OAuth available in this environment):
// - /admin is the only hard guard: the server layout 307-redirects to "/".
// - /conta renders a client-side "sign in to continue" prompt (HTTP 200).
// - /upgrade renders the plan page with a sign-in CTA instead of checkout.
// - /analyses renders its shell, but the history fetch fails (401) and the
//   page shows a graceful error state.
// - /billing/return renders a payment status view driven by query params.

test.describe("protected pages when signed out", () => {
  test("/admin redirects to the home page", async ({ page }) => {
    const response = await page.goto("/admin");
    // The 307 is followed by the browser; the final document is the landing page.
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("heading", { name: /encontre todas as mídias/i })).toBeVisible();
  });

  test("/conta shows a sign-in prompt instead of account data", async ({ page }) => {
    const response = await page.goto("/conta");
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Entre para ver sua conta", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /continuar com google/i })).toBeVisible();
    // None of the authenticated sections may leak through.
    await expect(page.getByText(/excluir minha conta/i)).toHaveCount(0);
  });

  test("/upgrade renders with a sign-in CTA instead of checkout", async ({ page }) => {
    const response = await page.goto("/upgrade");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /planeje seu próximo trabalho/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /entrar para assinar/i })).toBeVisible();
  });

  test("/analyses shows a graceful error when the history API rejects", async ({ page }) => {
    const response = await page.goto("/analyses");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /minhas análises/i })).toBeVisible();
    // GET /api/analyses returns 401 signed out; the page must degrade, not crash.
    // (Scoped by text: the Next.js dev overlay also renders a role="alert".)
    await expect(page.getByRole("alert").filter({ hasText: /não foi possível carregar seu histórico/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /tentar novamente/i })).toBeVisible();
  });

  test("/billing/return reflects a failed checkout from query params", async ({ page }) => {
    const response = await page.goto("/billing/return?status=failure");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /não foi possível concluir o pagamento/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /voltar ao grabix/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /ver plano e pagamento/i })).toHaveAttribute("href", "/upgrade");
  });
});
