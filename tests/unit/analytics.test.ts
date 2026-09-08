import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { captureAttribution, trackConversion, withCurrentUtm } from "../../src/lib/analytics.ts";

type EventProperties = Record<string, string | number | boolean | undefined>;

interface FakeWindowOptions {
  search?: string;
  origin?: string;
  pathname?: string;
  stored?: Record<string, string>;
  throwOnGetItem?: boolean;
  throwOnSetItem?: boolean;
  withDataLayer?: boolean;
  withGtag?: boolean;
  withFbq?: boolean;
}

interface FakeWindow {
  location: { search: string; origin: string; pathname: string; href: string };
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
  dataLayer?: Array<Record<string, unknown>>;
  gtagCalls: Array<{ command: string; event: string; properties: EventProperties }>;
  fbqCalls: Array<{ command: string; event: string; properties: EventProperties }>;
  gtag?: (command: "event", event: string, properties?: EventProperties) => void;
  fbq?: (command: "trackCustom", event: string, properties?: EventProperties) => void;
}

function installFakeWindow(options: FakeWindowOptions = {}): FakeWindow {
  const {
    search = "",
    origin = "https://grabix.app",
    pathname = "/",
    stored = {},
    throwOnGetItem = false,
    throwOnSetItem = false,
    withDataLayer = true,
    withGtag = true,
    withFbq = true,
  } = options;

  const storage = new Map(Object.entries(stored));
  const fake: FakeWindow = {
    location: { search, origin, pathname, href: `${origin}${pathname}${search}` },
    localStorage: {
      getItem(key) {
        if (throwOnGetItem) throw new Error("storage indisponível");
        return storage.has(key) ? (storage.get(key) as string) : null;
      },
      setItem(key, value) {
        if (throwOnSetItem) throw new Error("quota excedida");
        storage.set(key, value);
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    gtagCalls: [],
    fbqCalls: [],
  };

  if (withDataLayer) fake.dataLayer = [];
  if (withGtag) {
    fake.gtag = (command, event, properties) => {
      fake.gtagCalls.push({ command, event, properties: properties ?? {} });
    };
  }
  if (withFbq) {
    fake.fbq = (command, event, properties) => {
      fake.fbqCalls.push({ command, event, properties: properties ?? {} });
    };
  }

  (globalThis as Record<string, unknown>).window = fake;
  return fake;
}

function removeWindow() {
  delete (globalThis as Record<string, unknown>).window;
}

afterEach(() => {
  removeWindow();
});

// ─── trackConversion ───

describe("trackConversion", () => {
  test("não faz nada quando window não existe (SSR)", () => {
    removeWindow();
    assert.doesNotThrow(() => trackConversion("cta_click"));
  });

  test("envia evento para dataLayer, gtag e fbq com o mesmo payload", () => {
    const fake = installFakeWindow();
    trackConversion("plan_selected", { plan: "pro", price: 49.9 });

    assert.equal(fake.dataLayer?.length, 1);
    assert.deepEqual(fake.dataLayer?.[0], { event: "plan_selected", plan: "pro", price: 49.9 });

    assert.equal(fake.gtagCalls.length, 1);
    assert.deepEqual(fake.gtagCalls[0], {
      command: "event",
      event: "plan_selected",
      properties: { plan: "pro", price: 49.9 },
    });

    assert.equal(fake.fbqCalls.length, 1);
    assert.deepEqual(fake.fbqCalls[0], {
      command: "trackCustom",
      event: "plan_selected",
      properties: { plan: "pro", price: 49.9 },
    });
  });

  test("funciona sem nenhum provider instalado (dataLayer/gtag/fbq ausentes)", () => {
    installFakeWindow({ withDataLayer: false, withGtag: false, withFbq: false });
    assert.doesNotThrow(() => trackConversion("checkout_started"));
  });

  test("funciona com objeto de propriedades vazio (default)", () => {
    const fake = installFakeWindow();
    trackConversion("extractor_view");
    assert.deepEqual(fake.dataLayer?.[0], { event: "extractor_view" });
  });

  test("inclui parâmetros utm_* da URL atual no payload", () => {
    const fake = installFakeWindow({ search: "?utm_source=google&utm_medium=cpc&pagina=1" });
    trackConversion("cta_click", { botao: "hero" });

    const payload = fake.dataLayer?.[0] as Record<string, unknown>;
    assert.equal(payload.utm_source, "google");
    assert.equal(payload.utm_medium, "cpc");
    assert.equal(payload.pagina, undefined, "parâmetros não-utm não entram no payload");
    assert.equal(payload.botao, "hero");
  });

  test("utm da URL tem precedência sobre o localStorage salvo", () => {
    const fake = installFakeWindow({
      search: "?utm_source=email",
      stored: { "grabix:attribution:v1": JSON.stringify({ utm_source: "google", utm_campaign: "lancamento" }) },
    });
    trackConversion("cta_click");

    const payload = fake.dataLayer?.[0] as Record<string, unknown>;
    assert.equal(payload.utm_source, "email");
    assert.equal(payload.utm_campaign, undefined);
  });

  test("usa attribution do localStorage quando a URL não tem utm", () => {
    const fake = installFakeWindow({
      stored: { "grabix:attribution:v1": JSON.stringify({ utm_source: "google", utm_term: "extrator" }) },
    });
    trackConversion("pricing_view");

    const payload = fake.dataLayer?.[0] as Record<string, unknown>;
    assert.equal(payload.utm_source, "google");
    assert.equal(payload.utm_term, "extrator");
  });

  test("ignora localStorage com JSON malformado sem lançar erro", () => {
    const fake = installFakeWindow({
      stored: { "grabix:attribution:v1": "{nao-e-json" },
    });
    assert.doesNotThrow(() => trackConversion("cta_click"));
    assert.deepEqual(fake.dataLayer?.[0], { event: "cta_click" });
  });

  test("ignora localStorage com valor que não é objeto (número, string, null)", () => {
    for (const storedValue of ["42", '"texto"', "null", "true"]) {
      const fake = installFakeWindow({
        stored: { "grabix:attribution:v1": storedValue },
      });
      trackConversion("cta_click");
      assert.deepEqual(fake.dataLayer?.[0], { event: "cta_click" }, `valor armazenado: ${storedValue}`);
      removeWindow();
    }
  });

  test("sobrevive a localStorage que lança exceção na leitura", () => {
    const fake = installFakeWindow({ throwOnGetItem: true });
    assert.doesNotThrow(() => trackConversion("cta_click"));
    assert.deepEqual(fake.dataLayer?.[0], { event: "cta_click" });
  });

  test("em colisão de chave, o utm de attribution sobrescreve a propriedade explícita", () => {
    // A implementação faz { ...properties, ...campaign }: a campanha (utm) vence em caso de colisão.
    const fake = installFakeWindow({ search: "?utm_source=google" });
    trackConversion("cta_click", { utm_source: "manual" } as EventProperties);
    const payload = fake.dataLayer?.[0] as Record<string, unknown>;
    assert.equal(payload.utm_source, "google");
  });
});

// ─── captureAttribution ───

describe("captureAttribution", () => {
  test("não faz nada quando window não existe (SSR)", () => {
    removeWindow();
    assert.doesNotThrow(() => captureAttribution());
  });

  test("não grava nada quando a URL não tem parâmetros utm_*", () => {
    const fake = installFakeWindow({ search: "?pagina=2&ref=abc" });
    let writes = 0;
    const originalSet = fake.localStorage.setItem;
    fake.localStorage.setItem = (key, value) => {
      writes++;
      originalSet(key, value);
    };
    captureAttribution();
    assert.equal(writes, 0);
  });

  test("salva apenas os parâmetros utm_* como JSON", () => {
    const fake = installFakeWindow({
      search: "?utm_source=google&utm_campaign=black+friday&pagina=2",
    });
    captureAttribution();
    const saved = fake.localStorage.getItem("grabix:attribution:v1");
    assert.ok(saved);
    assert.deepEqual(JSON.parse(saved), {
      utm_source: "google",
      utm_campaign: "black friday",
    });
  });

  test("em parâmetro utm repetido, o último valor vence", () => {
    const fake = installFakeWindow({ search: "?utm_source=a&utm_source=b" });
    captureAttribution();
    const saved = fake.localStorage.getItem("grabix:attribution:v1");
    assert.deepEqual(JSON.parse(saved as string), { utm_source: "b" });
  });

  test("não lança erro quando localStorage.setItem falha (quota/modo privado)", () => {
    installFakeWindow({ search: "?utm_source=google", throwOnSetItem: true });
    assert.doesNotThrow(() => captureAttribution());
  });
});

// ─── withCurrentUtm ───

describe("withCurrentUtm", () => {
  test("retorna o href inalterado quando window não existe (SSR)", () => {
    removeWindow();
    assert.equal(withCurrentUtm("/precos"), "/precos");
  });

  test("retorna inalterado hrefs que não começam com '/'", () => {
    installFakeWindow({ search: "?utm_source=google" });
    assert.equal(withCurrentUtm("https://externo.com/x"), "https://externo.com/x");
    assert.equal(withCurrentUtm("#secao"), "#secao");
    assert.equal(withCurrentUtm("mailto:a@b.com"), "mailto:a@b.com");
    assert.equal(withCurrentUtm(""), "");
  });

  test("acrescenta os utm_* da URL atual a um href relativo", () => {
    installFakeWindow({ search: "?utm_source=google&utm_medium=cpc" });
    const result = withCurrentUtm("/precos");
    assert.equal(result, "/precos?utm_source=google&utm_medium=cpc");
  });

  test("ignora parâmetros não-utm da URL atual", () => {
    installFakeWindow({ search: "?utm_source=google&pagina=3" });
    assert.equal(withCurrentUtm("/precos"), "/precos?utm_source=google");
  });

  test("não sobrescreve parâmetro utm já presente no href", () => {
    installFakeWindow({ search: "?utm_source=google&utm_medium=cpc" });
    const result = withCurrentUtm("/precos?utm_source=newsletter");
    const url = new URL(result, "https://grabix.app");
    assert.equal(url.searchParams.get("utm_source"), "newsletter");
    assert.equal(url.searchParams.get("utm_medium"), "cpc");
  });

  test("preserva pathname, query existente e hash do href", () => {
    installFakeWindow({ search: "?utm_source=google" });
    const result = withCurrentUtm("/precos?plano=pro#anual");
    assert.equal(result, "/precos?plano=pro&utm_source=google#anual");
  });

  test("sem utm na URL atual, retorna o href equivalente", () => {
    installFakeWindow({ search: "" });
    assert.equal(withCurrentUtm("/precos"), "/precos");
  });
});
