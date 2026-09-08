"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "./theme-provider";

interface ThemeToggleProps {
  className?: string;
  variant?: "icon" | "segmented";
}

export function ThemeToggle({ className = "", variant = "icon" }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] text-[var(--g-muted)] ${className}`}
        aria-hidden="true"
      >
        <span className="h-4 w-4 rounded-full bg-[var(--g-line-hover)]/40 animate-pulse" />
      </div>
    );
  }

  if (variant === "segmented") {
    return (
      <fieldset
        className={`inline-flex items-center rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] p-1 text-xs font-semibold ${className}`}
      >
        <legend className="sr-only">Selecionar tema</legend>
        <button
          type="button"
          onClick={() => setTheme("light")}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${
            theme === "light"
              ? "bg-[var(--g-surface-1)] text-[var(--g-ink)] shadow-sm"
              : "text-[var(--g-muted)] hover:text-[var(--g-ink)]"
          }`}
          aria-pressed={theme === "light"}
        >
          <Sun className="h-3.5 w-3.5" />
          <span>Claro</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${
            theme === "dark"
              ? "bg-[var(--g-surface-1)] text-[var(--g-ink)] shadow-sm"
              : "text-[var(--g-muted)] hover:text-[var(--g-ink)]"
          }`}
          aria-pressed={theme === "dark"}
        >
          <Moon className="h-3.5 w-3.5" />
          <span>Escuro</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("system")}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${
            theme === "system"
              ? "bg-[var(--g-surface-1)] text-[var(--g-ink)] shadow-sm"
              : "text-[var(--g-muted)] hover:text-[var(--g-ink)]"
          }`}
          aria-pressed={theme === "system"}
        >
          <span>Auto</span>
        </button>
      </fieldset>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Mudar para modo claro" : "Mudar para modo escuro"}
      aria-label={isDark ? "Mudar para modo claro" : "Mudar para modo escuro"}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] text-[var(--g-sub)] transition-colors hover:border-[var(--g-accent-border)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)] ${className}`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 transition-transform duration-200 hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 transition-transform duration-200 hover:-rotate-12" />
      )}
    </button>
  );
}
