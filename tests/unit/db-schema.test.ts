import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  accounts,
  adminAuditLog,
  pendingEntitlements,
  planConfig,
  savedAnalyses,
  sessions,
  subscriptions,
  urlFailures,
  usageDaily,
  users,
  verificationTokens,
  webhookEvents,
} from "../../src/server/db/schema.ts";

// Importar o schema NÃO abre conexão com o banco: são apenas definições
// pg-core. Os testes usam getTableConfig para inspecionar a forma das tabelas.

type TableConfig = ReturnType<typeof getTableConfig>;

function col(cfg: TableConfig, name: string) {
  const column = cfg.columns.find((c) => c.name === name);
  assert.ok(column, `coluna ${name} deve existir`);
  return column;
}

function colNames(cfg: TableConfig): string[] {
  return cfg.columns.map((c) => c.name);
}

function indexCols(idx: TableConfig["indexes"][number]): string[] {
  return idx.config.columns.map((c) => (c as { name?: string }).name ?? String(c));
}

function fkSummary(cfg: TableConfig) {
  return cfg.foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      columns: ref.columns.map((c) => c.name),
      foreignTable: ref.foreignTable,
      foreignColumns: ref.foreignColumns.map((c) => c.name),
      onDelete: fk.onDelete,
    };
  });
}

// ─── Tabelas esperadas ───

test("todas as tabelas esperadas existem com os nomes físicos corretos", () => {
  const esperado: Array<[unknown, string]> = [
    [users, "user"],
    [accounts, "account"],
    [sessions, "session"],
    [verificationTokens, "verificationToken"],
    [subscriptions, "subscription"],
    [usageDaily, "usage_daily"],
    [pendingEntitlements, "pending_entitlement"],
    [webhookEvents, "webhook_event"],
    [urlFailures, "url_failure"],
    [savedAnalyses, "saved_analysis"],
    [planConfig, "plan_config"],
    [adminAuditLog, "admin_audit_log"],
  ];
  for (const [table, nome] of esperado) {
    assert.equal(getTableConfig(table as Parameters<typeof getTableConfig>[0]).name, nome);
  }
});

// ─── users ───

test("users: id é PK com default (uuid) e email é único", () => {
  const cfg = getTableConfig(users);
  const id = col(cfg, "id");
  assert.equal(id.primary, true);
  assert.equal(id.notNull, true);
  assert.equal(id.hasDefault, true, "id tem $defaultFn(crypto.randomUUID)");
  assert.equal(col(cfg, "email").isUnique, true, "email deve ser unique");
  assert.deepEqual(colNames(cfg), ["id", "name", "email", "emailVerified", "image", "isAdmin", "createdAt"]);
});

test("users: isAdmin é notNull com default false e createdAt tem defaultNow", () => {
  const cfg = getTableConfig(users);
  const isAdmin = col(cfg, "isAdmin");
  assert.equal(isAdmin.notNull, true);
  assert.equal(isAdmin.hasDefault, true);
  const createdAt = col(cfg, "createdAt");
  assert.equal(createdAt.notNull, true);
  assert.equal(createdAt.hasDefault, true);
});

// ─── accounts / sessions / verificationTokens (Auth.js) ───

test("accounts: PK composta (provider, providerAccountId) e FK userId cascade", () => {
  const cfg = getTableConfig(accounts);
  assert.equal(
    cfg.columns.some((c) => c.primary),
    false,
    "nenhuma coluna é PK individual",
  );
  assert.equal(cfg.primaryKeys.length, 1);
  assert.deepEqual(
    cfg.primaryKeys[0].columns.map((c) => c.name),
    ["provider", "providerAccountId"],
  );
  const fks = fkSummary(cfg);
  assert.equal(fks.length, 1);
  assert.deepEqual(fks[0].columns, ["userId"]);
  assert.equal(fks[0].foreignTable, users);
  assert.deepEqual(fks[0].foreignColumns, ["id"]);
  assert.equal(fks[0].onDelete, "cascade");
});

test("accounts: colunas OAuth esperadas estão presentes", () => {
  const cfg = getTableConfig(accounts);
  assert.deepEqual(colNames(cfg), [
    "userId",
    "type",
    "provider",
    "providerAccountId",
    "refresh_token",
    "access_token",
    "expires_at",
    "token_type",
    "scope",
    "id_token",
    "session_state",
  ]);
  for (const obrigatoria of ["userId", "type", "provider", "providerAccountId"]) {
    assert.equal(col(cfg, obrigatoria).notNull, true, obrigatoria);
  }
});

test("sessions: sessionToken é PK e userId referencia users com cascade", () => {
  const cfg = getTableConfig(sessions);
  assert.equal(col(cfg, "sessionToken").primary, true);
  const fks = fkSummary(cfg);
  assert.equal(fks.length, 1);
  assert.deepEqual(fks[0].columns, ["userId"]);
  assert.equal(fks[0].foreignTable, users);
  assert.equal(fks[0].onDelete, "cascade");
  assert.equal(col(cfg, "expires").notNull, true);
});

test("verificationTokens: PK composta (identifier, token), sem coluna PK individual", () => {
  const cfg = getTableConfig(verificationTokens);
  assert.equal(cfg.primaryKeys.length, 1);
  assert.deepEqual(
    cfg.primaryKeys[0].columns.map((c) => c.name),
    ["identifier", "token"],
  );
  assert.equal(cfg.foreignKeys.length, 0);
});

// ─── subscriptions ───

test("subscriptions: userId é unique (uma assinatura por usuário) com FK cascade", () => {
  const cfg = getTableConfig(subscriptions);
  const uniqueUser = cfg.indexes.find((i) => i.config.name === "subscription_userId_unique");
  assert.ok(uniqueUser, "índice subscription_userId_unique deve existir");
  assert.equal(uniqueUser.config.unique, true);
  assert.deepEqual(indexCols(uniqueUser), ["userId"]);

  const fks = fkSummary(cfg);
  assert.equal(fks.length, 1);
  assert.deepEqual(fks[0].columns, ["userId"]);
  assert.equal(fks[0].foreignTable, users);
  assert.equal(fks[0].onDelete, "cascade");
});

test("subscriptions: índice composto (status, currentPeriodEnd) e defaults de plano", () => {
  const cfg = getTableConfig(subscriptions);
  const idx = cfg.indexes.find((i) => i.config.name === "subscription_status_periodEnd_idx");
  assert.ok(idx);
  assert.equal(idx.config.unique, false);
  assert.deepEqual(indexCols(idx), ["status", "currentPeriodEnd"]);
  assert.equal(col(cfg, "plan").hasDefault, true);
  assert.equal(col(cfg, "plan").notNull, true);
  assert.equal(col(cfg, "status").hasDefault, true);
  assert.equal(col(cfg, "updatedAt").hasDefault, true);
});

// ─── usage_daily ───

test("usageDaily: PK composta (userId, day), índice por day e FK cascade", () => {
  const cfg = getTableConfig(usageDaily);
  assert.equal(cfg.primaryKeys.length, 1);
  assert.deepEqual(
    cfg.primaryKeys[0].columns.map((c) => c.name),
    ["userId", "day"],
  );
  const idx = cfg.indexes.find((i) => i.config.name === "usage_daily_day_idx");
  assert.ok(idx);
  assert.deepEqual(indexCols(idx), ["day"]);
  assert.equal(col(cfg, "downloads").hasDefault, true);
  const fks = fkSummary(cfg);
  assert.equal(fks.length, 1);
  assert.equal(fks[0].foreignTable, users);
  assert.equal(fks[0].onDelete, "cascade");
});

// ─── pending_entitlement / webhook_event ───

test("pendingEntitlements: índice por email e defaults de plano/status", () => {
  const cfg = getTableConfig(pendingEntitlements);
  const idx = cfg.indexes.find((i) => i.config.name === "pending_entitlement_email_idx");
  assert.ok(idx);
  assert.deepEqual(indexCols(idx), ["email"]);
  assert.equal(col(cfg, "email").notNull, true);
  assert.equal(col(cfg, "plan").hasDefault, true);
  assert.equal(col(cfg, "status").hasDefault, true);
});

test("webhookEvents: id é PK SEM default (id vem do provedor)", () => {
  const cfg = getTableConfig(webhookEvents);
  const id = col(cfg, "id");
  assert.equal(id.primary, true);
  assert.equal(id.hasDefault, false, "id do evento é externo, não deve ter default");
  assert.equal(col(cfg, "provider").notNull, true);
  assert.equal(col(cfg, "receivedAt").hasDefault, true);
});

// ─── url_failure ───

test("urlFailures: unique composta (url, reason) e índices de triagem", () => {
  const cfg = getTableConfig(urlFailures);
  const unique = cfg.indexes.find((i) => i.config.name === "url_failure_url_reason_unique");
  assert.ok(unique);
  assert.equal(unique.config.unique, true);
  assert.deepEqual(indexCols(unique), ["url", "reason"]);

  const lastSeen = cfg.indexes.find((i) => i.config.name === "url_failure_lastSeenAt_idx");
  assert.ok(lastSeen);
  assert.deepEqual(indexCols(lastSeen), ["lastSeenAt"]);

  const hostResolved = cfg.indexes.find((i) => i.config.name === "url_failure_host_resolved_idx");
  assert.ok(hostResolved);
  assert.deepEqual(indexCols(hostResolved), ["host", "resolved"]);
});

test("urlFailures: lastUserId usa onDelete set null (não cascade)", () => {
  const cfg = getTableConfig(urlFailures);
  const fks = fkSummary(cfg);
  assert.equal(fks.length, 1);
  assert.deepEqual(fks[0].columns, ["lastUserId"]);
  assert.equal(fks[0].foreignTable, users);
  assert.equal(fks[0].onDelete, "set null");
  assert.equal(col(cfg, "count").hasDefault, true);
  assert.equal(col(cfg, "resolved").hasDefault, true);
});

// ─── saved_analysis ───

test("savedAnalyses: índices por usuário e FK cascade", () => {
  const cfg = getTableConfig(savedAnalyses);
  const byUpdated = cfg.indexes.find((i) => i.config.name === "saved_analysis_user_updated_idx");
  assert.ok(byUpdated);
  assert.deepEqual(indexCols(byUpdated), ["userId", "updatedAt"]);
  const byDomain = cfg.indexes.find((i) => i.config.name === "saved_analysis_user_domain_idx");
  assert.ok(byDomain);
  assert.deepEqual(indexCols(byDomain), ["userId", "domain"]);

  const fks = fkSummary(cfg);
  assert.equal(fks.length, 1);
  assert.deepEqual(fks[0].columns, ["userId"]);
  assert.equal(fks[0].onDelete, "cascade");

  assert.equal(col(cfg, "assets").notNull, true, "lista de mídia serializada é obrigatória");
  assert.equal(col(cfg, "selectedUrls").hasDefault, true);
});

// ─── plan_config / admin_audit_log ───

test("planConfig: colunas de limites e flags de recursos são obrigatórias", () => {
  const cfg = getTableConfig(planConfig);
  assert.equal(col(cfg, "id").primary, true);
  for (const obrigatoria of [
    "maxAssets",
    "maxFileSizeBytes",
    "maxZipSizeBytes",
    "maxConcurrentDownloads",
    "deepCrawl",
    "jsRendering",
    "protectedVideo",
    "downloadsPerDay",
  ]) {
    assert.equal(col(cfg, obrigatoria).notNull, true, obrigatoria);
  }
  assert.equal(col(cfg, "priceAmountCents").notNull, false, "preço é opcional (plano free)");
});

test("adminAuditLog: actorId e targetUserId são FKs cascade para users", () => {
  const cfg = getTableConfig(adminAuditLog);
  const idx = cfg.indexes.find((i) => i.config.name === "admin_audit_log_createdAt_idx");
  assert.ok(idx);
  assert.deepEqual(indexCols(idx), ["createdAt"]);

  const fks = fkSummary(cfg);
  assert.equal(fks.length, 2);
  const porColuna = new Map(fks.map((fk) => [fk.columns[0], fk]));
  assert.equal(porColuna.get("actorId")?.foreignTable, users);
  assert.equal(porColuna.get("actorId")?.onDelete, "cascade");
  assert.equal(porColuna.get("targetUserId")?.foreignTable, users);
  assert.equal(porColuna.get("targetUserId")?.onDelete, "cascade");
});
