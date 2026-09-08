import { expect, test } from "@playwright/test";

// robots.txt, sitemap.xml and the custom 404 page. All are static/dynamic
// metadata routes (src/app/robots.ts, src/app/sitemap.ts, src/app/not-found.tsx)
// and need no DB or auth.

test.describe("robots.txt", () => {
  test("is served as text/plain with the private routes disallowed", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");

    const body = await response.text();
    expect(body).toContain("User-Agent: *");
    expect(body).toContain("Allow: /");
    // Private/auth-gated/API areas must stay out of the index.
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /conta");
    expect(body).toContain("Disallow: /sign-in");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Sitemap: https://grabix.app/sitemap.xml");
  });
});

test.describe("sitemap.xml", () => {
  test("is served as XML listing only the public pages", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/xml");

    const body = await response.text();
    expect(body).toContain("<loc>https://grabix.app</loc>");
    expect(body).toContain("<loc>https://grabix.app/pricing</loc>");
    // Private or auth-gated pages are intentionally excluded.
    expect(body).not.toContain("/conta");
    expect(body).not.toContain("/admin");
    expect(body).not.toContain("/sign-in");
  });
});

test.describe("404 page", () => {
  test("unknown URLs render the friendly not-found page with status 404", async ({ page }) => {
    const response = await page.goto("/esta-rota-nao-existe-no-grabix");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { name: /página não encontrada/i })).toBeVisible();
    await expect(page.getByText(/essa rota não existe/i)).toBeVisible();

    const backHome = page.getByRole("link", { name: /voltar pro início/i });
    await expect(backHome).toBeVisible();
    await expect(backHome).toHaveAttribute("href", "/");
  });
});
