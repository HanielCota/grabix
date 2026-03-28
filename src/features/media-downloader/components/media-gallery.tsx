"use client";

import { Download, Image as ImageIcon, Package, Video, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AnalyzePageResult } from "../domain/types";
import { MediaCard } from "./media-card";
import { type FilterType, MediaFilters } from "./media-filters";

const PAGE_SIZE = 24;

interface MediaGalleryProps {
  result: AnalyzePageResult;
}

export function MediaGallery({ result }: MediaGalleryProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [isZipping, setIsZipping] = useState(false);
  const [zipMsg, setZipMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const zipAbortRef = useRef<AbortController | null>(null);

  // ─── Derived data ───

  const counts = useMemo(() => {
    const img = result.assets.filter((a) => a.type === "IMAGE").length;
    const vid = result.assets.filter((a) => a.type === "VIDEO").length;
    return { all: result.assets.length, IMAGE: img, VIDEO: vid };
  }, [result.assets]);

  const filtered = useMemo(() => {
    if (filter === "all") return result.assets;
    return result.assets.filter((a) => a.type === filter);
  }, [result.assets, filter]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // ─── Handlers ───

  function handleFilterChange(f: FilterType) {
    setFilter(f);
    setVisibleCount(PAGE_SIZE);
  }

  const cancelZip = useCallback(() => {
    zipAbortRef.current?.abort();
    setIsZipping(false);
  }, []);

  async function handleDownloadZip() {
    if (!filtered.length) return;

    // Capture count now so it doesn't go stale if the user changes filter during download
    const assetsToZip = filtered;
    const zipCount = assetsToZip.length;

    const controller = new AbortController();
    zipAbortRef.current = controller;
    setIsZipping(true);
    setZipMsg(null);
    try {
      const res = await fetch("/api/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assets: assetsToZip }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!res.ok) {
        const data = await res.json();
        setZipMsg({ type: "err", text: data.error?.message ?? "Erro ao gerar ZIP." });
        return;
      }

      const blob = await res.blob();

      // Check abort after the slow blob() await
      if (controller.signal.aborted) return;

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "grabix-media.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setZipMsg({ type: "ok", text: `${zipCount} arquivo${zipCount !== 1 ? "s" : ""} no ZIP.` });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setZipMsg({ type: "err", text: "Erro de conexão ao gerar ZIP." });
    } finally {
      setIsZipping(false);
    }
  }

  const host = useMemo(() => {
    try {
      return new URL(result.url).hostname.replace(/^www\./, "");
    } catch {
      return result.url;
    }
  }, [result.url]);

  // ─── Render ───

  return (
    <section className="space-y-6">
      {/* Summary panel */}
      <div className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--g-sub)]">Análise concluída</p>
            <h2 className="mt-1 text-2xl font-extrabold text-[var(--g-ink)]">
              {result.totalFound} mídia{result.totalFound !== 1 ? "s" : ""}
            </h2>
            <p className="mt-1 text-sm text-[var(--g-sub)]">{host}</p>
          </div>

          <div className="flex gap-3">
            {isZipping ? (
              <button
                type="button"
                onClick={cancelZip}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] px-5 text-sm font-bold text-[var(--g-danger)] transition-all hover:bg-[rgba(248,113,113,0.12)]"
              >
                <X className="h-4 w-4" />
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDownloadZip}
                disabled={filtered.length === 0}
                className="btn-primary inline-flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-bold"
              >
                <Package className="h-4 w-4" />
                ZIP ({filtered.length})
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            icon={<ImageIcon className="h-4 w-4" />}
            label="Imagens"
            value={counts.IMAGE}
            color="text-sky-400"
            bg="bg-sky-500/10"
          />
          <Stat
            icon={<Video className="h-4 w-4" />}
            label="Vídeos"
            value={counts.VIDEO}
            color="text-fuchsia-400"
            bg="bg-fuchsia-500/10"
          />
          <Stat
            icon={<Download className="h-4 w-4" />}
            label="Total"
            value={counts.all}
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

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <MediaFilters active={filter} onChange={handleFilterChange} counts={counts} />
        <p className="text-sm text-[var(--g-muted)]">
          {filtered.length} de {result.totalFound} visíveis
        </p>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--g-line)] py-16 text-center">
          <p className="text-sm text-[var(--g-muted)]">Nenhum resultado para este filtro.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((asset, i) => (
              <MediaCard key={asset.url} asset={asset} index={i} />
            ))}
          </div>

          {hasMore && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] px-6 text-sm font-semibold text-[var(--g-sub)] transition-all hover:bg-[var(--g-line)] hover:text-[var(--g-ink)] hover:border-[var(--g-line-hover)]"
              >
                Mostrar mais ({filtered.length - visibleCount} restantes)
              </button>
            </div>
          )}
        </>
      )}
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
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] px-4 py-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bg} ${color}`}>{icon}</div>
      <div>
        <p className={`text-xl font-bold ${color}`}>{value}</p>
        <p className="text-[11px] font-medium text-[var(--g-muted)]">{label}</p>
      </div>
    </div>
  );
}
