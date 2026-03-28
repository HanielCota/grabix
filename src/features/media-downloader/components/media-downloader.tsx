"use client";

import { ArrowLeft, BarChart3, CheckCircle2, History, Loader2, ScanSearch } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyzePageResult } from "../domain/types";
import { ErrorMessage } from "./error-message";
import { MediaGallery } from "./media-gallery";
import { UrlInput } from "./url-input";

type ViewState =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { status: "error"; message: string; url?: string }
  | { status: "success"; result: AnalyzePageResult };

const STORAGE_COUNT_KEY = "grabix_count";
const STORAGE_LAST_KEY = "grabix_last_url";

function getStoredCount(): number {
  try {
    return parseInt(localStorage.getItem(STORAGE_COUNT_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function getStoredLastUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_LAST_KEY);
  } catch {
    return null;
  }
}

const fadeSlide = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3 },
};

export function MediaDownloader() {
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const [resetKey, setResetKey] = useState(0);
  const [analyzeCount, setAnalyzeCount] = useState(0);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAnalyzeCount(getStoredCount());
    setLastUrl(getStoredLastUrl());
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ─── Handlers ───

  async function handleAnalyze(url: string) {
    if (!url?.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "loading", url });

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      const data = await response.json();
      if (controller.signal.aborted) return;

      if (!response.ok) {
        setState({ status: "error", message: data.error?.message ?? "Erro ao analisar a página.", url });
        return;
      }
      if (data.totalFound === 0) {
        setState({ status: "error", message: "Nenhuma mídia pública foi encontrada nesta página.", url });
        return;
      }

      setState({ status: "success", result: data });

      const newCount = analyzeCount + 1;
      setAnalyzeCount(newCount);
      setLastUrl(url);
      try {
        localStorage.setItem(STORAGE_COUNT_KEY, String(newCount));
        localStorage.setItem(STORAGE_LAST_KEY, url);
      } catch {
        /* quota */
      }

      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setState({ status: "error", message: "Falha na conexão. Verifique sua internet e tente novamente.", url });
    }
  }

  const handleBack = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle" });
    setResetKey((k) => k + 1);
  }, []);

  const currentUrl =
    state.status === "loading"
      ? state.url
      : state.status === "error"
        ? state.url
        : state.status === "success"
          ? state.result.url
          : null;

  // ─── Render ───

  return (
    <div className="space-y-6">
      <AnimatePresence mode="wait">
        {state.status === "idle" ? (
          <motion.div key="input" {...fadeSlide}>
            <UrlInput onSubmit={handleAnalyze} isLoading={false} resetKey={resetKey} />

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[var(--g-muted)]">
              {analyzeCount > 0 && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="inline-flex items-center gap-1.5"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  {analyzeCount} página{analyzeCount !== 1 ? "s" : ""} analisada{analyzeCount !== 1 ? "s" : ""}
                </motion.span>
              )}
              {lastUrl && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  type="button"
                  onClick={() => handleAnalyze(lastUrl)}
                  className="inline-flex items-center gap-1.5 text-[var(--g-sub)] transition-colors hover:text-[var(--g-ink)]"
                >
                  <History className="h-3.5 w-3.5" />
                  <span className="max-w-48 truncate font-mono underline decoration-[var(--g-line-hover)] underline-offset-2">
                    {lastUrl.replace(/^https?:\/\//, "")}
                  </span>
                </motion.button>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="nav"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-3 rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-2"
          >
            <button
              type="button"
              onClick={handleBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-[var(--g-sub)] transition-all hover:bg-[var(--g-line)] hover:text-[var(--g-ink)] hover:border-[var(--g-line-hover)]"
              title="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <p className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--g-sub)]" title={currentUrl ?? ""}>
              {currentUrl}
            </p>
            {state.status !== "loading" ? (
              <button
                type="button"
                onClick={handleBack}
                className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-[var(--g-sub)] transition-all hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
              >
                Nova busca
              </button>
            ) : (
              <button
                type="button"
                onClick={handleBack}
                className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-[var(--g-danger)] transition-all hover:bg-[var(--g-danger-bg)]"
              >
                Cancelar
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={resultsRef}>
        <AnimatePresence mode="wait">
          {state.status === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="rounded-2xl border border-[var(--g-line-hover)] bg-[var(--g-surface-1)] p-6"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--g-accent-glow)]">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--g-ink)]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--g-ink)]">Analisando página...</p>
                  <p className="mt-1 text-xs text-[var(--g-muted)]">Buscando imagens e vídeos no HTML</p>
                </div>
              </div>
              <div className="mt-5 flex gap-6 text-xs text-[var(--g-sub)]">
                <Step icon={<CheckCircle2 className="h-3.5 w-3.5 text-[var(--g-success)]" />} text="URL validada" />
                <Step
                  icon={<ScanSearch className="h-3.5 w-3.5 text-[var(--g-sub)] animate-pulse" />}
                  text="Extraindo mídias..."
                />
              </div>
            </motion.div>
          )}

          {state.status === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <ErrorMessage message={state.message} onDismiss={handleBack} />
            </motion.div>
          )}

          {state.status === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <MediaGallery result={state.result} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Step({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {text}
    </span>
  );
}
