"use client";

import { ArrowRight, Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

interface UrlInputProps {
  onSubmit: (url: string, deepCrawl: boolean) => void;
  isLoading: boolean;
  resetKey?: number;
}

export function UrlInput({ onSubmit, isLoading, resetKey }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [deepCrawl, setDeepCrawl] = useState(false);

  useEffect(() => {
    if (resetKey) setUrl("");
  }, [resetKey]);

  // ─── Handlers ───

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    onSubmit(normalized, deepCrawl);
  }

  // ─── Render ───

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label htmlFor="url-input" className="block text-sm font-semibold text-[var(--g-sub)]">
        URL da página
      </label>

      <div className="input-glow rounded-2xl">
        <div className="relative flex items-center gap-2 rounded-2xl border border-[var(--g-line-hover)] bg-[var(--g-surface-1)] p-1.5 transition-colors focus-within:border-[var(--g-accent-border)]">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--g-surface-3)] text-[var(--g-muted)]">
            <Search className="h-5 w-5" />
          </div>

          <input
            id="url-input"
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="exemplo.com/galeria ou cole a URL completa"
            disabled={isLoading}
            autoComplete="url"
            spellCheck={false}
            className="min-h-12 min-w-0 flex-1 bg-transparent px-2 text-[15px] text-[var(--g-ink)] placeholder:text-[var(--g-muted)] focus:outline-none disabled:opacity-50"
          />

          {url && !isLoading && (
            <button
              type="button"
              onClick={() => setUrl("")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--g-muted)] transition-all hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
              title="Limpar"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className="btn-primary inline-flex h-12 shrink-0 items-center gap-2 rounded-xl px-6 text-sm font-bold"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analisando...
              </>
            ) : (
              <>
                Extrair mídias
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setDeepCrawl((v) => !v)}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            deepCrawl ? "bg-[var(--g-accent)]" : "bg-[var(--g-surface-3)]"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              deepCrawl ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
        <span className="text-xs text-[var(--g-sub)]">
          Busca profunda
          <span className="text-[var(--g-muted)]"> — segue links para encontrar mais vídeos</span>
        </span>
      </div>

      <QuickExamples onSelect={setUrl} />
    </form>
  );
}

// ─── Quick examples ───

const EXAMPLES = [
  { label: "Wikipedia", url: "https://pt.wikipedia.org/wiki/Brasil" },
  { label: "Pexels", url: "https://www.pexels.com/search/nature/" },
  { label: "Unsplash", url: "https://unsplash.com/s/photos/city" },
];

function QuickExamples({ onSelect }: { onSelect: (url: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-[var(--g-muted)]">
      <span>Testa com:</span>
      {EXAMPLES.map((ex, i) => (
        <span key={ex.label}>
          <button
            type="button"
            onClick={() => onSelect(ex.url)}
            className="font-medium text-[var(--g-sub)] underline decoration-[var(--g-line-hover)] underline-offset-2 transition-colors hover:text-[var(--g-ink)]"
          >
            {ex.label}
          </button>
          {i < EXAMPLES.length - 1 && <span className="ml-1.5">·</span>}
        </span>
      ))}
    </div>
  );
}
