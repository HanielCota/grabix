"use client";

import { AlertCircle, ArrowRight, Globe, Loader2, Search, Shield, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DeepCrawlToggle } from "@/components/deep-crawl-toggle";
import type { CrawlConfig } from "@/lib/crawl/types";
import { getPublicUrlError, normalizeHttpUrlInput } from "@/lib/url/public-url";

type PartialCrawlConfig = Pick<CrawlConfig, "maxDepth" | "maxPages" | "followExternal">;

interface UrlInputProps {
  onSubmit: (url: string, deepCrawl: boolean, crawlConfig?: PartialCrawlConfig) => void;
  isLoading: boolean;
  resetKey?: number;
}

export function UrlInput({ onSubmit, isLoading, resetKey }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [deepCrawl, setDeepCrawl] = useState(false);
  const [crawlConfig, setCrawlConfig] = useState<PartialCrawlConfig>({
    maxDepth: 2,
    maxPages: 20,
    followExternal: false,
  });

  useEffect(() => {
    if (resetKey !== undefined) {
      setUrl("");
      setTouched(false);
    }
  }, [resetKey]);

  const validationError = useMemo(() => {
    if (!touched || !url.trim()) return null;
    return getPublicUrlError(url);
  }, [url, touched]);

  const errorId = validationError ? "url-input-error" : undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    const trimmed = url.trim();
    if (!trimmed) return;
    const error = getPublicUrlError(trimmed);
    if (error) return;
    const normalized = normalizeHttpUrlInput(trimmed);
    onSubmit(normalized, deepCrawl, deepCrawl ? crawlConfig : undefined);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Input bar */}
      <div className="rounded-2xl">
        <div
          className={`relative flex items-center gap-2 rounded-2xl border bg-[var(--g-surface-1)] p-1.5 transition-colors ${
            validationError
              ? "border-[var(--g-danger-border)]"
              : "border-[var(--g-line-hover)] focus-within:border-[var(--g-accent-border)]"
          }`}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--g-surface-3)] text-[var(--g-muted)]">
            <Search className="h-5 w-5" />
          </div>

          <label htmlFor="url-input" className="sr-only">
            URL pública para extrair mídia
          </label>
          <input
            id="url-input"
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (!touched && e.target.value.trim()) setTouched(true);
            }}
            placeholder="Cole uma URL aqui..."
            disabled={isLoading}
            autoComplete="url"
            spellCheck={false}
            aria-invalid={validationError ? "true" : "false"}
            aria-describedby={errorId}
            className="min-h-12 min-w-0 flex-1 bg-transparent px-2 text-[15px] text-[var(--g-ink)] placeholder:text-[var(--g-muted)] focus:outline-none disabled:opacity-50"
          />

          {url && !isLoading && (
            <button
              type="button"
              onClick={() => {
                setUrl("");
                setTouched(false);
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--g-muted)] transition-all hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
              aria-label="Limpar URL"
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
                Extrair
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        {/* Validation error */}
        {validationError && (
          <p id={errorId} className="mt-2 flex items-center gap-1.5 px-2 text-xs font-medium text-[var(--g-danger)]">
            <AlertCircle size={13} />
            {validationError}
          </p>
        )}
      </div>

      {/* Feature pills + deep crawl toggle */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Pill icon={<Globe size={16} />} text="Qualquer site" />
          <Pill icon={<Zap size={16} />} text="Em segundos" />
          <Pill icon={<Shield size={16} />} text="Sem cadastro" />
        </div>

        <DeepCrawlToggle
          enabled={deepCrawl}
          onEnabledChange={setDeepCrawl}
          config={crawlConfig}
          onConfigChange={setCrawlConfig}
        />
      </div>
    </form>
  );
}

function Pill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--g-line)] bg-[var(--g-surface-2)] px-4 py-2 text-sm font-medium text-[var(--g-muted)]">
      <span className="text-[var(--g-sub)]">{icon}</span>
      {text}
    </span>
  );
}
