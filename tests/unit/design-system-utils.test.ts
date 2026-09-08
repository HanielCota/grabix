import assert from "node:assert/strict";
import { test } from "node:test";
import { cx } from "../../src/design-system/utils.ts";

test("cx retorna string vazia sem argumentos", () => {
  assert.equal(cx(), "");
});

test("cx junta classes com espaço", () => {
  assert.equal(cx("a", "b", "c"), "a b c");
});

test("cx retorna a própria classe quando há apenas uma", () => {
  assert.equal(cx("btn"), "btn");
});

test("cx ignora false, null e undefined", () => {
  assert.equal(cx("a", false, "b", null, "c", undefined), "a b c");
});

test("cx ignora strings vazias (falsy)", () => {
  assert.equal(cx("a", "", "b"), "a b");
});

test("cx retorna vazio quando tudo é falsy", () => {
  assert.equal(cx(false, null, undefined, ""), "");
});

test("cx preserva a ordem dos argumentos", () => {
  assert.equal(cx("z-ultimo", "a-primeiro", "m-meio"), "z-ultimo a-primeiro m-meio");
});

test("cx mantém classes duplicadas (não deduplica)", () => {
  assert.equal(cx("btn", "btn"), "btn btn");
});

test("cx preserva espaços internos de classes compostas", () => {
  assert.equal(cx("flex  items-center", "p-4"), "flex  items-center p-4");
});

test("cx funciona no padrão típico de classes condicionais", () => {
  const active = true;
  const disabled = false;
  assert.equal(cx("btn", active && "btn-active", disabled && "btn-disabled"), "btn btn-active");
});
