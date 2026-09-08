import assert from "node:assert/strict";
import { test } from "node:test";
import { themeInitScript } from "../../src/components/theme/theme-provider.tsx";

test("themeInitScript contém código JavaScript executável", () => {
  assert.ok(typeof themeInitScript === "string");
  assert.ok(themeInitScript.length > 50);
  assert.ok(themeInitScript.includes("localStorage.getItem('grabix-theme')"));
  assert.ok(themeInitScript.includes("document.documentElement"));
  assert.ok(themeInitScript.includes("data-theme"));
});

test("themeInitScript executa sem erros de sintaxe", () => {
  assert.doesNotThrow(() => {
    new Function(themeInitScript);
  });
});
