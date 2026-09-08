import { expect, test } from "@playwright/test";

// Public API surface, exercised through Playwright's request client (no browser,
// no auth cookies). /api/plans and /api/pricing fall back to the code defaults
// when the DB is unreachable (see src/server/plans-config.ts), so they answer
// 200 deterministically here; we assert the response shape rather than the
// admin-editable values.

test.describe("public config endpoints", () => {
  test("GET /api/plans returns the plan definitions with no-store caching", async ({ request }) => {
    const response = await request.get("/api/plans");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");

    const body = await response.json();
    expect(typeof body.free?.maxAssets).toBe("number");
    expect(typeof body.pro?.maxAssets).toBe("number");
    expect(typeof body.free?.downloadsPerDay).toBe("number");
    expect(typeof body.pricing?.amountCents).toBe("number");
    expect(typeof body.pricing?.label).toBe("string");
  });

  test("GET /api/pricing returns the Pro price with no-store caching", async ({ request }) => {
    const response = await request.get("/api/pricing");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");

    const body = await response.json();
    expect(typeof body.proPriceLabel).toBe("string");
    expect(body.proPriceLabel.length).toBeGreaterThan(0);
    expect(typeof body.proAmountCents).toBe("number");
    expect(body.proAmountCents).toBeGreaterThan(0);
  });
});

test.describe("auth-gated API endpoints", () => {
  test("POST /api/analyze without a session returns 401 UNAUTHORIZED", async ({ request }) => {
    const response = await request.post("/api/analyze", { data: { url: "https://example.com" } });
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("POST /api/analyze with invalid JSON still returns 401 (auth runs before body parsing)", async ({ request }) => {
    const response = await request.post("/api/analyze", {
      headers: { "content-type": "application/json" },
      data: "{not-valid-json",
    });
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("GET /api/analyze is rejected with 405 and an Allow header", async ({ request }) => {
    const response = await request.get("/api/analyze");
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe("POST");

    const body = await response.json();
    expect(body.error?.code).toBe("METHOD_NOT_ALLOWED");
  });

  test("GET /api/download is rejected with 405 (downloads are POST-only)", async ({ request }) => {
    const response = await request.get("/api/download");
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe("POST");
  });

  test("POST /api/download without a session returns 401 before any validation", async ({ request }) => {
    const response = await request.post("/api/download", { data: {} });
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });
});

test.describe("security headers (next.config.ts)", () => {
  // HSTS is intentionally skipped: it is only sent outside development.
  for (const path of ["/", "/pricing", "/api/plans"]) {
    test(`${path} carries the hardening headers`, async ({ request }) => {
      const response = await request.get(path);
      const headers = response.headers();

      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    });
  }
});
