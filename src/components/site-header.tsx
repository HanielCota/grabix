"use client";

import { Crown, FileQuestion, Grab, LayoutDashboard, Menu, ScanSearch, Tag, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { GoogleIcon } from "@/components/icons/google-icon";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useUpgrade } from "@/components/upgrade/upgrade-context";
import { useMe } from "@/hooks/use-me";
import { usePricing } from "@/hooks/use-pricing";
import { trackConversion } from "@/lib/analytics";

// Shared between the desktop bar and the mobile sheet so navigation never drifts.
// Hash links jump to home-page sections from any route.
const NAV_LINKS = [
  { href: "/#como-funciona", label: "Como funciona", icon: ScanSearch },
  { href: "/#beneficios", label: "Recursos", icon: FileQuestion },
  { href: "/pricing", label: "Preços", icon: Tag },
] as const;

function isActive(pathname: string, href: string): boolean {
  return !href.includes("#") && pathname === href;
}

function PlanBadge({ plan }: { plan: "free" | "pro" }) {
  if (plan === "pro") {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-2.5 text-xs font-bold text-[var(--g-gold)]">
        <Crown className="h-3 w-3 text-[var(--g-gold)]" /> Pro
      </span>
    );
  }
  return (
    <span className="inline-flex h-9 items-center rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] px-2.5 text-xs font-semibold text-[var(--g-sub)]">
      Plano grátis
    </span>
  );
}

function UsagePill({ used, limit }: { used: number; limit: number }) {
  const remaining = Math.max(0, limit - used);
  const cls =
    remaining === 0
      ? "border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] text-[var(--g-danger)]"
      : remaining <= 5
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : "border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-[var(--g-sub)]";
  return (
    <span
      title={`${used} de ${limit} downloads usados hoje`}
      className={`inline-flex h-9 items-center rounded-xl border px-2.5 text-xs font-semibold tabular-nums ${cls}`}
    >
      {used}/{limit}
      <span className="hidden sm:inline">&nbsp;hoje</span>
    </span>
  );
}

// Skeleton placeholders while the session resolves, so the bar doesn't flash
// empty then pop the auth controls in (layout shift).
function AuthSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <span className="hidden h-9 w-20 animate-pulse rounded-xl bg-[var(--g-surface-3)] sm:block" />
      <span className="h-10 w-10 animate-pulse rounded-xl bg-[var(--g-surface-3)]" />
    </div>
  );
}

// Mobile-only sheet (hamburger) holding the site nav links and, for free users,
// the daily-quota line. Account actions stay in the avatar menu.
function MobileNav({ pathname, freeUsage }: { pathname: string; freeUsage: { used: number; limit: number } | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--g-line-hover)] bg-[var(--g-surface-2)] text-[var(--g-sub)] transition-colors hover:border-[var(--g-accent-border)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-3 w-64 overflow-hidden rounded-2xl border border-[var(--g-line-hover)] bg-[var(--g-surface-1)]/95 p-2 shadow-[0_24px_70px_rgba(0,0,0,0.25)] backdrop-blur-xl"
        >
          {freeUsage && (
            <div className="mb-2 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] px-3.5 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--g-muted)]">Downloads hoje</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-[var(--g-ink)]">
                {freeUsage.used} de {freeUsage.limit}
              </p>
            </div>
          )}
          <div className="space-y-1">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--g-brand)]/10 text-[var(--g-brand-light)]"
                      : "text-[var(--g-sub)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
                  }`}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-[var(--g-line)] px-2 pt-2">
            <span className="text-xs font-medium text-[var(--g-muted)]">Tema</span>
            <ThemeToggle />
          </div>
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  const { status } = useSession();
  const { me } = useMe();
  const plan = me?.plan ?? "free";
  const { open: openUpgrade } = useUpgrade();
  const { proPriceLabel } = usePricing();
  const pathname = usePathname();

  const isFree = plan === "free";
  const freeUsage = isFree && me?.usage?.limit != null ? { used: me.usage.used, limit: me.usage.limit } : null;

  if (pathname.startsWith("/admin") || (status === "authenticated" && (pathname === "/" || pathname === "/conta")))
    return null;

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)]/85 px-3 py-2 shadow-[0_12px_36px_rgba(0,0,0,0.08)] backdrop-blur-xl sm:px-4">
        <Link href="/" className="group inline-flex shrink-0 items-center gap-2.5" aria-label="Grabix - início">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--g-brand)]/25 bg-[var(--g-brand)]/[0.09] text-[var(--g-brand-light)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition duration-200 group-hover:scale-[1.04] group-hover:border-[var(--g-brand)]/45 group-hover:bg-[var(--g-brand)]/[0.15]">
            <Grab className="h-[19px] w-[19px]" strokeWidth={1.9} />
          </span>
          <span className="text-[15px] font-bold tracking-[-0.025em] text-[var(--g-ink)] sm:text-base">Grabix</span>
        </Link>

        <nav
          className="hidden items-center gap-1 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] p-1 sm:flex"
          aria-label="Principal"
        >
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-[var(--g-surface-1)] text-[var(--g-ink)] shadow-sm"
                    : "text-[var(--g-muted)] hover:bg-[var(--g-surface-3)]/60 hover:text-[var(--g-ink)]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />

          {status === "loading" && <AuthSkeleton />}

          {status === "authenticated" && (
            <>
              {me?.isAdmin && (
                <Link
                  href="/admin"
                  title="Painel admin"
                  className="hidden h-9 w-9 items-center justify-center rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] text-[var(--g-sub)] transition-colors hover:border-[var(--g-accent-border)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)] sm:inline-flex"
                >
                  <LayoutDashboard className="h-4 w-4" />
                </Link>
              )}
              {freeUsage && (
                <span className="hidden sm:inline-flex">
                  <UsagePill used={freeUsage.used} limit={freeUsage.limit} />
                </span>
              )}
              <span className="hidden sm:inline-flex">
                <PlanBadge plan={plan} />
              </span>
              {isFree && (
                <button
                  type="button"
                  onClick={() => openUpgrade()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--g-brand)] px-3 text-xs font-bold text-[var(--g-brand-btn-text)] shadow-[0_6px_18px_rgba(61,213,176,0.16)] transition hover:bg-[var(--g-brand-light)]"
                >
                  <Crown className="h-3.5 w-3.5" />
                  Assinar Pro
                  <span className="hidden font-semibold text-[var(--g-accent-text)]/65 sm:inline">
                    · {proPriceLabel}
                  </span>
                </button>
              )}
              <AccountMenu />
              <MobileNav pathname={pathname} freeUsage={freeUsage} />
            </>
          )}

          {status === "unauthenticated" && (
            <>
              {pathname !== "/sign-in" && (
                <button
                  type="button"
                  onClick={() => {
                    trackConversion("sign_in_start", { location: "header" });
                    signIn("google");
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--g-brand)] px-3.5 text-xs font-bold text-[var(--g-brand-btn-text)] shadow-[0_6px_18px_rgba(61,213,176,0.16)] transition hover:bg-[var(--g-brand-light)]"
                >
                  <GoogleIcon className="h-4 w-4" />
                  Começar grátis
                </button>
              )}
              <MobileNav pathname={pathname} freeUsage={null} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
