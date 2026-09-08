"use client";

import { Crown, Infinity as InfinityIcon, Loader2, LogOut, TriangleAlert } from "lucide-react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useState } from "react";
import { GoogleIcon } from "@/components/icons/google-icon";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useUpgrade } from "@/components/upgrade/upgrade-context";
import { useMe } from "@/hooks/use-me";
import { usePricing } from "@/hooks/use-pricing";

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return null;
  }
}

const DAY_MS = 86_400_000;
// One-time Pro pass length (mirrors PRO_PASS_DURATION_MS on the server) - used as
// the bar's full span only when we can't derive the real one from the period.
const PASS_MS = 31 * DAY_MS;

function proCountdown(periodEnd?: string | null, periodStart?: string | null): { days: number; pct: number } | null {
  if (!periodEnd) return null;
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(end)) return null;
  const remaining = end - Date.now();
  if (remaining <= 0) return null;
  // Prefer the real pass span (end - start) so recurring cycles of any length
  // fill the bar accurately; fall back to the standard one-month pass otherwise.
  const start = periodStart ? new Date(periodStart).getTime() : Number.NaN;
  const span = !Number.isNaN(start) && end > start ? end - start : PASS_MS;
  return {
    days: Math.ceil(remaining / DAY_MS),
    // Keep a sliver visible while active; fraction of the pass still remaining.
    pct: Math.max(2, Math.min(100, (remaining / span) * 100)),
  };
}

// Whole hours until the daily download quota resets (00:00 in Brazil).
function hoursUntilQuotaReset(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutesLeft = 24 * 60 - (h * 60 + m);
  return Math.max(1, Math.ceil(minutesLeft / 60));
}

export default function ContaPage() {
  const { data: session, status } = useSession();
  const { me, loading: meLoading } = useMe();
  const { open: openUpgrade } = useUpgrade();
  const { proPriceLabel } = usePricing();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "loading") {
    return (
      <main className="mx-auto flex max-w-2xl items-center justify-center px-5 py-20">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--g-sub)]" />
      </main>
    );
  }

  if (status !== "authenticated" || !session?.user) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16 text-center sm:px-8">
        <p className="text-base font-semibold text-[var(--g-ink)]">Entre para ver sua conta</p>
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/conta" })}
          className="btn-primary mx-auto mt-5 inline-flex h-11 items-center justify-center gap-2.5 rounded-xl px-6 text-sm font-semibold"
        >
          <GoogleIcon className="h-5 w-5" />
          Continuar com Google
        </button>
      </main>
    );
  }

  const user = session.user;
  const plan = me?.plan ?? "free";
  const isPro = plan === "pro";
  const proUntil = formatDate(me?.periodEnd);
  const countdown = proCountdown(me?.periodEnd, me?.periodStart);
  const barColor = !countdown
    ? "var(--g-gold)"
    : countdown.days <= 2
      ? "var(--g-danger)"
      : countdown.days <= 5
        ? "#f59e0b"
        : "var(--g-gold)";

  // Free daily-download quota, shown as a consumption bar (calm → amber → red).
  const usage = me?.usage;
  const hasFreeQuota = !isPro && usage?.limit != null && usage.limit > 0;
  const usedPct = hasFreeQuota ? Math.min(100, Math.round(((usage?.used ?? 0) / (usage?.limit || 1)) * 100)) : 0;
  const remaining = usage?.remaining ?? null;
  const quotaColor =
    remaining != null && remaining <= 0
      ? "var(--g-danger)"
      : remaining != null && remaining <= 1
        ? "#f59e0b"
        : "var(--g-success)";
  // While the plan/usage is still loading, show a skeleton instead of flashing
  // the Free state at someone who is actually Pro.
  const planLoading = meLoading && !me;

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "Não foi possível excluir a conta.");
        return;
      }
      await signOut({ callbackUrl: "/" });
    } catch {
      setError("Falha de conexão ao excluir a conta.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--g-brand)]">Preferências</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--g-ink)]">Perfil, plano e acesso</h1>
        <p className="mt-2 text-sm text-[var(--g-sub)]">
          Consulte seu uso atual e gerencie as informações da sua conta.
        </p>
      </div>

      {/* ── Profile ── */}
      <section className="flex items-center gap-4 rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-sm font-bold text-[var(--g-sub)]">
          {user.image ? (
            <img src={user.image} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            (user.name ?? user.email ?? "?").slice(0, 2).toUpperCase()
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[var(--g-ink)]">{user.name ?? "-"}</p>
          <p className="truncate text-sm text-[var(--g-muted)]">{user.email}</p>
          <p className="mt-0.5 text-sm text-[var(--g-muted)]">Perfil gerenciado pela sua conta Google.</p>
        </div>
      </section>

      {/* ── Appearance / Theme ── */}
      <section className="mt-4 flex flex-col gap-4 rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--g-ink)]">Aparência do sistema</p>
          <p className="mt-0.5 text-xs text-[var(--g-muted)]">
            Alterne entre modo claro, escuro ou sincronize com as preferências do seu dispositivo.
          </p>
        </div>
        <ThemeToggle variant="segmented" />
      </section>

      {/* ── Plan & usage ── */}
      <section className="mt-4 rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-5">
        {planLoading ? (
          // Skeleton enquanto plano/uso carrega - evita piscar "Free" para quem é Pro.
          <div className="animate-pulse">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="h-3 w-28 rounded bg-[var(--g-surface-3)]" />
                <div className="h-4 w-48 rounded bg-[var(--g-surface-3)]" />
              </div>
              <div className="h-10 w-32 rounded-xl bg-[var(--g-surface-3)]" />
            </div>
            <div className="mt-5 h-2 w-full rounded-full bg-[var(--g-surface-3)]" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-[var(--g-sub)]">Plano</span>
                  {isPro ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--g-accent-border)] bg-[var(--g-accent-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--g-ink)]">
                      <Crown size={10} className="text-[var(--g-gold)]" /> Pro
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--g-sub)]">
                      Free
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-[var(--g-sub)]">
                  {isPro
                    ? "Seu acesso Pro está ativo."
                    : hasFreeQuota
                      ? remaining != null && remaining <= 0
                        ? "Você usou todos os downloads de hoje."
                        : `Você ainda tem ${remaining} ${remaining === 1 ? "download" : "downloads"} hoje.`
                      : "Plano grátis."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openUpgrade()}
                className="btn-primary inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold"
              >
                <Crown className="h-4 w-4 text-[var(--g-gold)]" />
                {isPro ? "Renovar Pro" : `Assinar Pro · ${proPriceLabel}`}
              </button>
            </div>

            {/* Pro com data: contagem regressiva */}
            {isPro && countdown && (
              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-semibold text-[var(--g-ink)]">
                    {countdown.days === 1 ? "Falta 1 dia" : `Faltam ${countdown.days} dias`}
                  </span>
                  {proUntil && <span className="text-[var(--g-muted)]">até {proUntil}</span>}
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-[var(--g-surface-3)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(countdown.pct)}
                  aria-label="Tempo restante do plano Pro"
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${countdown.pct}%`, background: barColor }}
                  />
                </div>
              </div>
            )}

            {/* Pro sem data (acesso concedido): selo vitalício, sem contagem falsa */}
            {isPro && !countdown && (
              <div className="mt-5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--g-accent-border)] bg-[var(--g-accent-soft)] px-2.5 py-1 text-xs font-bold text-[var(--g-ink)]">
                  <InfinityIcon className="h-3.5 w-3.5 text-[var(--g-gold)]" /> Acesso vitalício
                </span>
                <span className="text-sm text-[var(--g-muted)]">sem expiração</span>
              </div>
            )}

            {/* Free: consumo da quota diária + horário de renovação */}
            {hasFreeQuota && (
              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-semibold text-[var(--g-ink)]">
                    {usage?.used} de {usage?.limit} downloads hoje
                  </span>
                  <span className="text-[var(--g-muted)]">renova em {hoursUntilQuotaReset()}H</span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-[var(--g-surface-3)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={usedPct}
                  aria-label="Downloads usados hoje"
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(2, usedPct)}%`, background: quotaColor }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Session ── */}
      <section className="mt-4 flex items-center justify-between rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-5">
        <div>
          <p className="text-sm font-semibold text-[var(--g-ink)]">Sessão</p>
          <p className="text-sm text-[var(--g-muted)]">Sair desta conta neste dispositivo.</p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] px-4 text-sm font-semibold text-[var(--g-ink)] transition-colors hover:bg-[var(--g-line)]"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </section>

      {/* ── Danger zone ── */}
      <section className="mt-4 rounded-2xl border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--g-danger)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--g-ink)]">Excluir conta</p>
            <p className="mt-1 text-sm text-[var(--g-sub)]">
              Remove permanentemente sua conta, assinatura e histórico. Esta ação não pode ser desfeita.
            </p>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--g-danger-border)] bg-transparent px-4 text-sm font-semibold text-[var(--g-danger)] transition-colors hover:bg-[rgba(248,113,113,0.12)]"
              >
                Excluir minha conta
              </button>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--g-ink)]">Tem certeza?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--g-danger)] px-4 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sim, excluir
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="inline-flex h-9 items-center rounded-xl border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] px-4 text-sm font-semibold text-[var(--g-ink)] transition-colors hover:bg-[var(--g-line)] disabled:opacity-60"
                >
                  Cancelar
                </button>
              </div>
            )}

            {error && <p className="mt-2 text-sm font-medium text-[var(--g-danger)]">{error}</p>}
          </div>
        </div>
      </section>
    </section>
  );
}
