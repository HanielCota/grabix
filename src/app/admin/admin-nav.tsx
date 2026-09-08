"use client";

import { AlertTriangle, ArrowLeft, CreditCard, LayoutDashboard, Menu, SlidersHorizontal, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const LINKS = [
  { href: "/admin", label: "Visão geral", icon: LayoutDashboard },
  { href: "/admin/users", label: "Usuários", icon: Users },
  { href: "/admin/subscriptions", label: "Assinaturas", icon: CreditCard },
  { href: "/admin/failed-urls", label: "Monitoramento", icon: AlertTriangle },
] as const;

const SETTINGS = [{ href: "/admin/plans", label: "Planos e preço", icon: SlidersHorizontal }] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--g-muted)]">Operação</p>
      <div className="space-y-1">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${active ? "bg-[var(--g-brand)]/10 text-[var(--g-brand-light)]" : "text-[var(--g-sub)] hover:bg-[var(--g-surface-2)] hover:text-[var(--g-ink)]"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </div>
      <p className="mt-8 px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--g-muted)]">
        Configurações
      </p>
      <div className="space-y-1">
        {SETTINGS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${active ? "bg-[var(--g-brand)]/10 text-[var(--g-brand-light)]" : "text-[var(--g-sub)] hover:bg-[var(--g-surface-2)] hover:text-[var(--g-ink)]"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function AdminNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 border-r border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-5 lg:flex lg:flex-col">
        <Link href="/admin" className="flex items-center gap-3 px-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--g-brand)] text-sm font-black text-[#06241f]">
            G
          </span>
          <span>
            <strong className="block text-sm text-[var(--g-ink)]">Grabix</strong>
            <small className="text-xs text-[var(--g-muted)]">Administração</small>
          </span>
        </Link>
        <nav className="mt-10 flex-1" aria-label="Administração">
          <NavLinks />
        </nav>
        <div className="mb-3 flex items-center justify-between px-3 py-1.5 border-t border-[var(--g-line)] pt-3">
          <span className="text-xs font-medium text-[var(--g-muted)]">Tema</span>
          <ThemeToggle />
        </div>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--g-muted)] hover:bg-[var(--g-surface-2)] hover:text-[var(--g-ink)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao Grabix
        </Link>
      </aside>
      <div className="flex h-14 items-center justify-between border-b border-[var(--g-line)] bg-[var(--g-bg)] px-4 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2 font-semibold text-[var(--g-ink)]">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--g-brand)] text-xs font-black text-[#06241f]">
            G
          </span>
          Grabix
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--g-line-hover)] bg-[var(--g-surface-2)] text-[var(--g-ink)]"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <aside className="relative h-full w-72 bg-[var(--g-bg)] px-4 py-6 shadow-2xl">
            <div className="mb-9 flex items-center justify-between">
              <span className="font-semibold text-[var(--g-ink)]">Navegação</span>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setOpen(false)}
                className="text-[var(--g-sub)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav aria-label="Administração móvel">
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  );
}
