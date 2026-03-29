import { appConfig } from "@/server/config";

/**
 * Renders a page with a headless browser (Playwright) to capture
 * JavaScript-generated content. Falls back gracefully when Playwright
 * is not installed or JS rendering is disabled.
 *
 * Playwright is a purely optional dependency — the project builds and
 * runs without it. When GRABIX_JS_RENDERING=true and Playwright is
 * installed, pages are rendered with headless Chromium.
 */

// biome-ignore lint/suspicious/noExplicitAny: Playwright types are optional
let playwrightModule: any = null;
let loadAttempted = false;

// biome-ignore lint/suspicious/noExplicitAny: dynamic import
async function loadPlaywright(): Promise<any> {
  if (loadAttempted) return playwrightModule;
  loadAttempted = true;

  try {
    // Plain `await import("playwright")` fails because TypeScript and bundlers
    // resolve the module specifier at compile time, producing a build error
    // when Playwright is not installed. Using `Function()` with a string literal
    // makes the import fully opaque to static analysis.
    const moduleName = "playwright";
    playwrightModule = await (Function(`return import("${moduleName}")`)() as Promise<unknown>);
    return playwrightModule;
  } catch {
    return null;
  }
}

// ─── Availability check (cached synchronously after first probe) ───

let availabilityCache: boolean | null = null;

export async function isJsRenderingAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  if (!appConfig.enableJsRendering) {
    availabilityCache = false;
    return false;
  }
  const pw = await loadPlaywright();
  availabilityCache = pw !== null;
  return availabilityCache;
}

export interface RenderResult {
  html: string;
  resolvedUrl: string;
}

// ─── Browser singleton ───
// Reuse a single Chromium instance across requests, creating new contexts
// per request for isolation. The browser is closed on process exit.

// biome-ignore lint/suspicious/noExplicitAny: Playwright types are optional
let browserInstance: any = null;
// biome-ignore lint/suspicious/noExplicitAny: Playwright types are optional
let browserLaunching: Promise<any> | null = null;

// biome-ignore lint/suspicious/noExplicitAny: Playwright types are optional
async function getBrowser(pw: any): Promise<any> {
  if (browserInstance?.isConnected()) return browserInstance;

  // Prevent concurrent launches
  if (browserLaunching) return browserLaunching;

  browserLaunching = (async () => {
    browserInstance = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    // Clean up on process exit
    const cleanup = () => {
      browserInstance?.close().catch(() => {});
      browserInstance = null;
    };
    process.once("exit", cleanup);
    process.once("SIGTERM", cleanup);

    // Relaunch on unexpected disconnect
    browserInstance.on("disconnected", () => {
      browserInstance = null;
      browserLaunching = null;
    });

    browserLaunching = null;
    return browserInstance;
  })();

  return browserLaunching;
}

/**
 * Fetch and render a page using a headless Chromium browser.
 * Returns the fully rendered HTML after JS execution.
 *
 * @throws if Playwright is not installed or the page fails to load
 */
export async function renderPage(url: string, signal?: AbortSignal): Promise<RenderResult> {
  const pw = await loadPlaywright();
  if (!pw) {
    throw new Error(
      "Playwright não está instalado. Execute: npm install playwright && npx playwright install chromium",
    );
  }

  const timeoutMs = appConfig.limits.fetchTimeoutMs;
  const browser = await getBrowser(pw);

  const context = await browser.newContext({
    userAgent: appConfig.userAgent,
    locale: "en-US",
    bypassCSP: true,
    javaScriptEnabled: true,
  });

  const page = await context.newPage();

  // Abort handling
  const onAbort = () => page.close().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    // Block unnecessary resources to speed up rendering
    // biome-ignore lint/suspicious/noExplicitAny: Playwright route type
    await page.route("**/*", (route: any) => {
      const type = route.request().resourceType();
      if (["font", "stylesheet", "media"].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });

    if (!response) {
      throw new Error("Nenhuma resposta recebida da página.");
    }

    // Scroll down to trigger lazy loading
    await page.evaluate(async () => {
      const distance = 400;
      const scrollDelay = 150;
      const maxScrolls = 8;
      let scrolls = 0;

      while (scrolls < maxScrolls) {
        window.scrollBy(0, distance);
        await new Promise((r) => setTimeout(r, scrollDelay));
        scrolls++;

        if (window.innerHeight + window.scrollY >= document.body.scrollHeight) {
          break;
        }
      }

      window.scrollTo(0, 0);
    });

    // Wait for any network requests triggered by scrolling to settle
    await page.waitForLoadState("networkidle").catch(() => {});

    const html: string = await page.content();
    const resolvedUrl: string = page.url();

    return { html, resolvedUrl };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await context.close();
  }
}
