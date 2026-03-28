"use client";

import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Image as ImageIcon,
  Layers,
  Loader2,
  Package,
  Square,
  Video,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mediaAssetSchema } from "@/features/media-downloader/domain/types";
import type { CrawlResult, MediaItem, PageResult } from "@/lib/crawl/types";
import { DeepCrawlMediaCard } from "./deep-crawl-media-card";

interface CrawlResultsProps {
  results: CrawlResult;
}

function mediaItemToAsset(media: MediaItem) {
  const ext = media.url.match(/\.(\w{2,5})(?:[?#]|$)/)?.[1] ?? (media.type === "video" ? "mp4" : "jpg");
  const fileName = media.title
    ? `${media.title.replace(/[/\\<>:"|?*]+/g, "_").slice(0, 80)}.${ext}`
    : `media-${media.videoId ?? Date.now()}.${ext}`;
  const raw = {
    url: media.url,
    type: media.type === "video" ? ("VIDEO" as const) : ("IMAGE" as const),
    fileName,
    extension: ext,
    sourceTag: media.source,
  };
  const parsed = mediaAssetSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function CrawlResults({ results }: CrawlResultsProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showEmptyPages, setShowEmptyPages] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipMsg, setZipMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const zipAbortRef = useRef<AbortController | null>(null);
  // All pages with media start expanded — use index-based keys to handle duplicate URLs
  const [expandedPages, setExpandedPages] = useState<Set<number>>(() => {
    const expanded = new Set<number>();
    for (let i = 0; i < results.results.length; i++) {
      if (results.results[i].media.length > 0) expanded.add(i);
    }
    return expanded;
  });

  const allMedia = useMemo(() => {
    const items: Array<{ pageUrl: string; media: MediaItem }> = [];
    for (const page of results.results) {
      for (const media of page.media) {
        items.push({ pageUrl: page.url, media });
      }
    }
    return items;
  }, [results.results]);

  const counts = useMemo(() => {
    let images = 0;
    let videos = 0;
    for (const { media } of allMedia) {
      if (media.type === "image") images++;
      else videos++;
    }
    return { images, videos, total: allMedia.length };
  }, [allMedia]);

  const sortedPages = useMemo(() => {
    return results.results
      .map((page, idx) => ({ page, idx }))
      .sort((a, b) => {
        if (a.page.media.length > 0 && b.page.media.length === 0) return -1;
        if (a.page.media.length === 0 && b.page.media.length > 0) return 1;
        return a.page.depth - b.page.depth;
      });
  }, [results.results]);

  const togglePage = useCallback((idx: number) => {
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleMedia = useCallback((mediaUrl: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mediaUrl)) next.delete(mediaUrl);
      else next.add(mediaUrl);
      return next;
    });
  }, []);

  const selectAllForPage = useCallback((page: PageResult) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = page.media.every((m) => prev.has(m.url));
      for (const m of page.media) {
        if (allSelected) next.delete(m.url);
        else next.add(m.url);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === allMedia.length) return new Set();
      return new Set(allMedia.map((m) => m.media.url));
    });
  }, [allMedia]);

  // Ctrl+A to select all
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        selectAll();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectAll]);

  const assetsForZip = useMemo(() => {
    const items = selected.size > 0 ? allMedia.filter((m) => selected.has(m.media.url)) : allMedia;
    return items.map((m) => mediaItemToAsset(m.media)).filter((a) => a !== null);
  }, [allMedia, selected]);

  const host = useMemo(() => {
    try {
      return new URL(results.originalUrl).hostname.replace(/^www\./, "");
    } catch {
      return "media";
    }
  }, [results.originalUrl]);

  async function handleDownloadZip() {
    if (!assetsForZip.length) return;
    const capped = assetsForZip.slice(0, 200);
    const count = capped.length;
    const controller = new AbortController();
    zipAbortRef.current = controller;
    setIsZipping(true);
    setZipMsg(
      assetsForZip.length > 200
        ? { type: "err", text: "Limite de 200 arquivos por ZIP. Os primeiros 200 serão incluídos." }
        : null,
    );
    try {
      const res = await fetch("/api/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assets: capped }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const data = await res.json();
        setZipMsg({ type: "err", text: data.error?.message ?? "Erro ao gerar ZIP." });
        return;
      }
      const blob = await res.blob();
      if (controller.signal.aborted) return;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `grabix-${host}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setZipMsg({ type: "ok", text: `${count} arquivo${count !== 1 ? "s" : ""} no ZIP.` });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setZipMsg({ type: "err", text: "Erro de conexão ao gerar ZIP." });
    } finally {
      setIsZipping(false);
    }
  }

  const zipLabel =
    selected.size > 0
      ? `ZIP (${selected.size} selecionado${selected.size !== 1 ? "s" : ""})`
      : `ZIP (${allMedia.length})`;

  return (
    <section className="space-y-5">
      {/* Summary panel */}
      <div className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--g-sub)]">
              Busca profunda concluída
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-[var(--g-ink)]">
              {results.totalMedia} mídia{results.totalMedia !== 1 ? "s" : ""}
            </h2>
            <p className="mt-1 text-sm text-[var(--g-sub)]">
              {results.pagesCrawled} página{results.pagesCrawled !== 1 ? "s" : ""} analisada
              {results.pagesCrawled !== 1 ? "s" : ""}
              {results.pagesWithErrors > 0 && (
                <span className="ml-2 text-xs text-[var(--g-danger)]">({results.pagesWithErrors} com erro)</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={selectAll}
              className={`inline-flex h-9 items-center gap-2 rounded-xl border px-4 text-xs font-bold transition-all ${
                selected.size === allMedia.length && allMedia.length > 0
                  ? "border-[var(--g-accent-border)] bg-[var(--g-accent-soft)] text-[var(--g-ink)]"
                  : "border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-[var(--g-sub)] hover:text-[var(--g-ink)] hover:border-[var(--g-accent-border)]"
              }`}
            >
              {selected.size === allMedia.length && allMedia.length > 0 ? (
                <CheckSquare size={14} />
              ) : (
                <Square size={14} />
              )}
              {selected.size === allMedia.length && allMedia.length > 0 ? "Desmarcar" : "Selecionar"} tudo
            </button>
            {selected.size > 0 && (
              <span className="rounded-lg bg-[var(--g-accent-soft)] px-2.5 py-1 text-xs font-bold text-[var(--g-ink)]">
                {selected.size}
              </span>
            )}

            {/* ZIP button */}
            {isZipping ? (
              <button
                type="button"
                onClick={() => {
                  zipAbortRef.current?.abort();
                  setIsZipping(false);
                }}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] px-4 text-xs font-bold text-[var(--g-danger)] transition-all hover:bg-[rgba(248,113,113,0.12)]"
              >
                <X size={14} />
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDownloadZip}
                disabled={allMedia.length === 0}
                className="btn-primary inline-flex h-9 items-center gap-2 rounded-xl px-4 text-xs font-bold"
              >
                {isZipping ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
                {zipLabel}
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            icon={<ImageIcon className="h-4 w-4" />}
            label="Imagens"
            value={counts.images}
            color="text-sky-400"
            bg="bg-sky-500/10"
          />
          <Stat
            icon={<Video className="h-4 w-4" />}
            label="Vídeos"
            value={counts.videos}
            color="text-fuchsia-400"
            bg="bg-fuchsia-500/10"
          />
          <Stat
            icon={<Layers className="h-4 w-4" />}
            label="Páginas"
            value={results.pagesCrawled}
            color="text-amber-400"
            bg="bg-amber-500/10"
          />
          <Stat
            icon={<Clock className="h-4 w-4" />}
            label="Tempo"
            value={results.crawlDurationMs > 0 ? `${(results.crawlDurationMs / 1000).toFixed(1)}s` : "-"}
            color="text-[var(--g-ink)]"
            bg="bg-[var(--g-accent-soft)]"
          />
        </div>
      </div>

      {/* ZIP feedback */}
      {zipMsg && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            zipMsg.type === "ok"
              ? "border border-[var(--g-success-border)] bg-[var(--g-success-bg)] text-[var(--g-success)]"
              : "border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] text-[var(--g-danger)]"
          }`}
        >
          {zipMsg.text}
        </div>
      )}

      {/* Page accordion sections */}
      <div className="space-y-2.5">
        {sortedPages
          .filter(({ page }) => showEmptyPages || page.media.length > 0)
          .map(({ page, idx }) => {
            const isExpanded = expandedPages.has(idx);
            const hasMedia = page.media.length > 0;
            const allPageSelected = hasMedia && page.media.every((m) => selected.has(m.url));

            return (
              <div
                key={`${page.url}-${idx}`}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  isExpanded && hasMedia
                    ? "border-[var(--g-line-hover)] bg-[var(--g-surface-1)]"
                    : "border-[var(--g-line)] bg-[var(--g-surface-1)]"
                }`}
              >
                {/* Page header */}
                <button
                  type="button"
                  onClick={() => togglePage(idx)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--g-surface-2)]"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--g-surface-3)] text-[var(--g-muted)]">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <Globe size={14} className="shrink-0 text-[var(--g-sub)]" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--g-sub)]" title={page.url}>
                    {page.title ?? page.url}
                  </span>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Depth badge */}
                    <span className="rounded-md bg-[var(--g-surface-3)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--g-muted)]">
                      {page.depth}
                    </span>

                    {/* Media count */}
                    {hasMedia && (
                      <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                        {page.media.length}
                      </span>
                    )}

                    {page.error && (
                      <span className="rounded-md bg-[var(--g-danger-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--g-danger)]">
                        erro
                      </span>
                    )}

                    {page.possibleSpa && (
                      <span title="Possível SPA">
                        <AlertTriangle size={13} className="text-amber-400/70" />
                      </span>
                    )}
                  </div>
                </button>

                {/* Expanded content */}
                <AnimatePresence>
                  {isExpanded && hasMedia && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-[var(--g-line)] px-4 py-4">
                        {/* Select all for page */}
                        <button
                          type="button"
                          onClick={() => selectAllForPage(page)}
                          className={`mb-4 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                            allPageSelected
                              ? "border-[var(--g-accent-border)] bg-[var(--g-accent-soft)] text-[var(--g-ink)]"
                              : "border-[var(--g-line)] text-[var(--g-sub)] hover:border-[var(--g-line-hover)] hover:text-[var(--g-ink)]"
                          }`}
                        >
                          {allPageSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                          {allPageSelected ? "Desmarcar" : "Selecionar"} todos
                        </button>

                        {/* Media grid */}
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                          {page.media.map((media, i) => (
                            <DeepCrawlMediaCard
                              key={media.url}
                              media={media}
                              index={i}
                              selected={selected.has(media.url)}
                              onToggle={() => toggleMedia(media.url)}
                            />
                          ))}
                        </div>

                        {page.possibleSpa && (
                          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/5 px-3.5 py-2.5">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
                            <p className="text-[11px] leading-relaxed text-amber-300/70">
                              Esta página pode usar JavaScript para carregar conteúdo. Alguns resultados podem estar
                              incompletos.
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

        {/* Toggle empty pages */}
        {results.results.some((p) => p.media.length === 0) && (
          <button
            type="button"
            onClick={() => setShowEmptyPages((v) => !v)}
            className="mx-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--g-muted)] transition-colors hover:text-[var(--g-sub)]"
          >
            {showEmptyPages
              ? "Esconder páginas vazias"
              : `Mostrar ${results.results.filter((p) => p.media.length === 0).length} páginas sem mídia`}
          </button>
        )}
      </div>
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  bg: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] px-3.5 py-2.5">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bg} ${color}`}>{icon}</div>
      <div>
        <p className={`text-lg font-bold leading-none ${color}`}>{value}</p>
        <p className="mt-0.5 text-[10px] font-medium text-[var(--g-muted)]">{label}</p>
      </div>
    </div>
  );
}
