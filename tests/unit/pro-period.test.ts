import assert from "node:assert/strict";
import { test } from "node:test";
import { proDaysLeft } from "../../src/lib/plans/pro-period.ts";

const DAY_MS = 86_400_000;

// ─── Ausência de expiração (lifetime / free) ───

test("proDaysLeft retorna null para undefined", () => {
  assert.equal(proDaysLeft(undefined), null);
});

test("proDaysLeft retorna null para null", () => {
  assert.equal(proDaysLeft(null), null);
});

test("proDaysLeft retorna null para string vazia", () => {
  assert.equal(proDaysLeft(""), null);
});

// ─── Datas inválidas ───

test("proDaysLeft retorna null para string que não é data", () => {
  assert.equal(proDaysLeft("não é uma data"), null);
});

test("proDaysLeft retorna null para data malformada", () => {
  assert.equal(proDaysLeft("2026-13-45T99:99:99Z"), null);
});

// ─── Pass já expirado ───

test("proDaysLeft retorna null para data no passado", () => {
  const past = new Date(Date.now() - DAY_MS).toISOString();
  assert.equal(proDaysLeft(past), null);
});

test("proDaysLeft retorna null para epoch (1970)", () => {
  assert.equal(proDaysLeft("1970-01-01T00:00:00.000Z"), null);
});

test("proDaysLeft retorna null para expiração de 1ms atrás", () => {
  const justPassed = new Date(Date.now() - 1).toISOString();
  assert.equal(proDaysLeft(justPassed), null);
});

// ─── Pass ativo: arredondamento para cima ───

test("proDaysLeft arredonda fração de dia para cima (1 hora → 1 dia)", () => {
  const inOneHour = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(proDaysLeft(inOneHour), 1);
});

test("proDaysLeft conta poucos segundos restantes como 1 dia", () => {
  const soon = new Date(Date.now() + 5_000).toISOString();
  assert.equal(proDaysLeft(soon), 1);
});

test("proDaysLeft retorna 1 para exatamente 1 dia à frente", () => {
  const inOneDay = new Date(Date.now() + DAY_MS).toISOString();
  assert.equal(proDaysLeft(inOneDay), 1);
});

test("proDaysLeft retorna 2 para 25 horas à frente (arredonda para cima)", () => {
  const in25Hours = new Date(Date.now() + 25 * 3_600_000).toISOString();
  assert.equal(proDaysLeft(in25Hours), 2);
});

test("proDaysLeft retorna 30 para 30 dias à frente", () => {
  const in30Days = new Date(Date.now() + 30 * DAY_MS).toISOString();
  assert.equal(proDaysLeft(in30Days), 30);
});

test("proDaysLeft aceita formato de data sem horário (ISO date-only)", () => {
  const days = proDaysLeft("2999-12-31");
  assert.ok(days !== null && days > 0);
});
