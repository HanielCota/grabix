"use client";

import { ArrowLeft, CheckCircle2, Loader2, ScanSearch } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CrawlProgress } from "@/components/crawl-progress";
import { CrawlResults } from "@/components/crawl-results";
import { useDeepCrawl } from "@/hooks/use-deep-crawl";
import type { CrawlConfig } from "@/lib/crawl/types";
import type { AnalyzePageResult } from "../domain/types";
import { analyzePageResultSchema } from "../domain/types";
import { ErrorMessage } from "./error-message";
import { MediaGallery } from "./media-gallery";
import { UrlInput } from "./url-input";

type PartialCrawlConfig = Pick<CrawlConfig, "maxDepth" | "maxPages" | "followExternal">;

type ViewState =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { status: "error"; message: string; url?: string; canRetryDeep?: boolean }
  | { status: "empty"; message: string; url: string; canRetryDeep?: boolean }
  | { status: "success"; result: AnalyzePageResult }
  | { status: "deep_crawling"; url: string }
  | { status: "deep_complete"; url: string }
  | { status: "deep_error"; url: string; message: string };

const fadeSlide = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3 },
};

const fadeIn = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } };
const fadeInDeep = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } };
const navTransition = { duration: 0.25 };
const sectionTransition = { duration: 0.3 };
const resultTransition = { duration: 0.4 };

export function MediaDownloader() {
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const [resetKey, setResetKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const deepCrawl = useDeepCrawl();

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Sync deep crawl status to view state
  useEffect(() => {
    if (deepCrawl.status === "complete" && deepCrawl.results) {
      setState((prev) => {
        if (prev.status === "deep_crawling") {
          return { status: "deep_complete", url: prev.url };
        }
        return prev;
      });

      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else if (deepCrawl.status === "error" && deepCrawl.error) {
      setState((prev) => {
        if (prev.status === "deep_crawling") {
          return { status: "deep_error", url: prev.url, message: deepCrawl.error ?? "Erro desconhecido" };
        }
        return prev;
      });
    }
  }, [deepCrawl.status, deepCrawl.results, deepCrawl.error]);

  // ─── Handlers ───

  async function handleAnalyze(url: string, useDeepCrawl = false, crawlConfig?: PartialCrawlConfig) {
    if (!url?.trim()) return;

    abortRef.current?.abort();

    if (useDeepCrawl) {
      setState({ status: "deep_crawling", url });
      deepCrawl.startCrawl(url, crawlConfig ?? {});
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "loading", url });

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, deepCrawl: false }),
        signal: controller.signal,
      });

      const data = await response.json();
      if (controller.signal.aborted) return;

      if (!response.ok) {
        if (response.status === 429) {
          setState({
            status: "error",
            message: "Muitas requisições. Aguarde alguns segundos e tente novamente.",
            url,
          });
          return;
        }
        const code = data.error?.code ?? "";
        const message = data.error?.message ?? "Erro ao analisar a página.";
        const hint =
          code === "SSRF_BLOCKED"
            ? "Essa URL aponta para um endereço restrito."
            : code === "NOT_HTML"
              ? "A resposta não é uma página HTML. Verifique se a URL é de uma página web."
              : code === "FETCH_FAILED" && message.includes("login")
                ? "Essa página exige login. O Grabix só acessa páginas públicas."
                : message;
        setState({ status: "error", message: hint, url });
        return;
      }
      const parsed = analyzePageResultSchema.safeParse(data);
      if (!parsed.success) {
        setState({ status: "error", message: "Resposta inválida do servidor.", url });
        return;
      }

      if (parsed.data.totalFound === 0) {
        setState({
          status: "empty",
          message: "Nenhuma mídia pública foi encontrada nesta página.",
          url,
          canRetryDeep: true,
        });
        return;
      }

      setState({ status: "success", result: parsed.data });

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
    deepCrawl.reset();
    setState({ status: "idle" });
    setResetKey((k) => k + 1);
  }, [deepCrawl.reset]);

  const handleAbortCrawl = useCallback(() => {
    deepCrawl.abort();
    handleBack();
  }, [deepCrawl.abort, handleBack]);

  // Keyboard shortcut: Esc to go back
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && state.status !== "idle") {
        e.preventDefault();
        handleBack();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.status, handleBack]);

  const currentUrl = (() => {
    switch (state.status) {
      case "loading":
      case "error":
      case "empty":
      case "deep_crawling":
      case "deep_complete":
      case "deep_error":
        return state.url;
      case "success":
        return state.result.url;
      default:
        return null;
    }
  })();

  const isLoading = state.status === "loading" || state.status === "deep_crawling";

  // ─── Render ───

  return (
    <div className="space-y-6">
      <AnimatePresence mode="wait">
        {state.status === "idle" ? (
          <motion.div key="input" {...fadeSlide}>
            <UrlInput onSubmit={handleAnalyze} isLoading={false} resetKey={resetKey} />
          </motion.div>
        ) : (
          <motion.div
            key="nav"
            initial={fadeSlide.initial}
            animate={fadeSlide.animate}
            exit={fadeSlide.exit}
            transition={navTransition}
            className="flex items-center gap-3 rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-2"
          >
            <button
              type="button"
              onClick={handleBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-[var(--g-sub)] transition-all hover:bg-[var(--g-line)] hover:text-[var(--g-ink)] hover:border-[var(--g-line-hover)]"
              aria-label="Voltar para nova busca"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <p className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--g-sub)]" title={currentUrl ?? ""}>
              {currentUrl}
            </p>
            {!isLoading ? (
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
          {/* Standard loading */}
          {state.status === "loading" && (
            <motion.div
              key="loading"
              {...fadeIn}
              transition={sectionTransition}
              className="rounded-2xl border border-[var(--g-line-hover)] bg-[var(--g-surface-1)] p-6"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--g-surface-3)]">
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

              {/* Skeleton preview */}
              <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
                {["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => (
                  <div
                    key={id}
                    className="animate-pulse overflow-hidden rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)]"
                  >
                    <div className="h-32 bg-[var(--g-surface-3)]" />
                    <div className="space-y-2 p-3">
                      <div className="h-3 w-3/4 rounded bg-[var(--g-surface-3)]" />
                      <div className="h-2 w-1/2 rounded bg-[var(--g-surface-3)]" />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Deep crawl progress */}
          {state.status === "deep_crawling" && (
            <motion.div key="deep-crawling" {...fadeIn} transition={sectionTransition}>
              <CrawlProgress
                pagesDone={deepCrawl.progress.pagesDone}
                pagesTotal={deepCrawl.progress.pagesTotal}
                mediaFound={deepCrawl.progress.mediaFound}
                activityLog={deepCrawl.activityLog}
                onAbort={handleAbortCrawl}
              />
            </motion.div>
          )}

          {/* Standard error */}
          {state.status === "error" && (
            <motion.div key="error" {...fadeIn} transition={sectionTransition}>
              <ErrorMessage
                message={state.message}
                onDismiss={handleBack}
                action={
                  state.canRetryDeep && state.url
                    ? {
                        label: "Tentar busca profunda",
                        onClick: () => {
                          if (state.url) handleAnalyze(state.url, true);
                        },
                      }
                    : undefined
                }
              />
            </motion.div>
          )}

          {/* Standard empty */}
          {state.status === "empty" && (
            <motion.div key="empty" {...fadeIn} transition={sectionTransition}>
              <ErrorMessage
                title="Nenhuma mídia encontrada"
                tone="neutral"
                message={state.message}
                onDismiss={handleBack}
                action={
                  state.canRetryDeep
                    ? {
                        label: "Tentar busca profunda",
                        onClick: () => handleAnalyze(state.url, true),
                      }
                    : undefined
                }
              />
            </motion.div>
          )}

          {/* Deep crawl error */}
          {state.status === "deep_error" && (
            <motion.div key="deep-error" {...fadeIn} transition={sectionTransition}>
              <ErrorMessage message={state.message} onDismiss={handleBack} />
            </motion.div>
          )}

          {/* Standard success */}
          {state.status === "success" && (
            <motion.div key="success" {...fadeInDeep} transition={resultTransition}>
              <MediaGallery result={state.result} />
            </motion.div>
          )}

          {/* Deep crawl success */}
          {state.status === "deep_complete" && deepCrawl.results && (
            <motion.div key="deep-success" {...fadeInDeep} transition={resultTransition}>
              <CrawlResults results={deepCrawl.results} />
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
