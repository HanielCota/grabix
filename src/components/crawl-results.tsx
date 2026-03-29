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
  Package,
  RotateCcw,
  Search,
  Square,
  Video,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { mediaAssetSchema } from "@/features/media-downloader/domain/types";
import type { CrawlResult, MediaContentKind, MediaItem, PageKind, PageResult } from "@/lib/crawl/types";
import { DeepCrawlMediaCard } from "./deep-crawl-media-card";

type AvailabilityFilter = "all" | "downloadable" | "link_only";
type MediaTypeFilter = "all" | "image" | "video";
type ConfidenceFilter = "all" | "high" | "medium" | "low";

const EXT_PATTERN = /\.(\w{2,5})(?:[?#]|$)/;
const UNSAFE_FILENAME_PATTERN = /[/\\<>:"|?*]+/g;
const DIACRITICS_PATTERN = /[\u0300-\u036f]/g;

interface CrawlResultsProps {
  results: CrawlResult;
}

interface VisiblePageEntry {
  page: PageResult;
  idx: number;
  visibleMedia: MediaItem[];
  downloadableMedia: MediaItem[];
  pageMatchesSearch: boolean;
}

function mediaItemToAsset(media: MediaItem) {
  if (!media.downloadable) {
    return null;
  }

  const ext = media.url.match(EXT_PATTERN)?.[1] ?? (media.type === "video" ? "mp4" : "jpg");
  const fileName = media.title
    ? `${media.title.replace(UNSAFE_FILENAME_PATTERN, "_").slice(0, 80)}.${ext}`
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
  const [searchQuery, setSearchQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [contentKindFilter, setContentKindFilter] = useState<string>("all");
  const [pageKindFilter, setPageKindFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const zipAbortRef = useRef<AbortController | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  // All pages with media start expanded — use index-based keys to handle duplicate URLs
  const [expandedPages, setExpandedPages] = useState<Set<number>>(() => {
    const expanded = new Set<number>();
    for (let i = 0; i < results.results.length; i++) {
      if (results.results[i].media.length > 0) expanded.add(i);
    }
    return expanded;
  });

  useEffect(() => {
    return () => {
      zipAbortRef.current?.abort();
    };
  }, []);

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

  const availablePlatforms = useMemo(
    () =>
      Array.from(
        new Set(
          allMedia.map(({ media }) => media.platform).filter((platform): platform is string => Boolean(platform)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [allMedia],
  );

  const availableContentKinds = useMemo(
    () =>
      Array.from(
        new Set(
          allMedia
            .map(({ media }) => media.contentKind)
            .filter((contentKind): contentKind is MediaContentKind => Boolean(contentKind)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [allMedia],
  );

  const availablePageKinds = useMemo(
    () =>
      Array.from(
        new Set(
          results.results.map((page) => page.pageKind).filter((pageKind): pageKind is PageKind => Boolean(pageKind)),
        ),
      ),
    [results.results],
  );

  const normalizedQuery = useMemo(() => normalizeText(deferredSearchQuery.trim()), [deferredSearchQuery]);

  const hasActiveFilters =
    normalizedQuery.length > 0 ||
    availabilityFilter !== "all" ||
    mediaTypeFilter !== "all" ||
    platformFilter !== "all" ||
    contentKindFilter !== "all" ||
    pageKindFilter !== "all" ||
    confidenceFilter !== "all" ||
    showEmptyPages;

  const pageEntries = useMemo<VisiblePageEntry[]>(() => {
    return results.results
      .map((page, idx) => {
        const pageSearchText = normalizeText(
          [page.title, page.url, page.discoveredFrom, page.discoveryReason, page.pageKind].join(" "),
        );
        const pageMatchesSearch = normalizedQuery.length === 0 || pageSearchText.includes(normalizedQuery);
        const visibleMedia = page.media.filter((media) => {
          if (availabilityFilter === "downloadable" && !media.downloadable) return false;
          if (availabilityFilter === "link_only" && media.downloadable) return false;
          if (mediaTypeFilter !== "all" && media.type !== mediaTypeFilter) return false;
          if (platformFilter !== "all" && (media.platform ?? "none") !== platformFilter) return false;
          if (contentKindFilter !== "all" && (media.contentKind ?? "none") !== contentKindFilter) return false;
          if (!matchesConfidenceFilter(media.confidence, confidenceFilter)) return false;

          if (normalizedQuery.length === 0 || pageMatchesSearch) {
            return true;
          }

          const mediaSearchText = normalizeText(
            [
              media.title,
              media.url,
              media.canonicalUrl,
              media.platform,
              media.source,
              media.discoveryReason,
              media.contentKind,
            ].join(" "),
          );
          return mediaSearchText.includes(normalizedQuery);
        });

        return {
          page,
          idx,
          visibleMedia,
          downloadableMedia: visibleMedia.filter((media) => media.downloadable),
          pageMatchesSearch,
        };
      })
      .filter(({ page, visibleMedia, pageMatchesSearch }) => {
        const pageMatchesKind = pageKindFilter === "all" || page.pageKind === pageKindFilter;
        if (!pageMatchesKind) return false;
        if (visibleMedia.length > 0) return true;
        return showEmptyPages && pageMatchesSearch;
      })
      .sort((a, b) => {
        if (a.visibleMedia.length > 0 && b.visibleMedia.length === 0) return -1;
        if (a.visibleMedia.length === 0 && b.visibleMedia.length > 0) return 1;
        return a.page.depth - b.page.depth;
      });
  }, [
    availabilityFilter,
    confidenceFilter,
    contentKindFilter,
    mediaTypeFilter,
    normalizedQuery,
    pageKindFilter,
    platformFilter,
    results.results,
    showEmptyPages,
  ]);

  const filteredMedia = useMemo(() => {
    const items: Array<{ pageUrl: string; media: MediaItem }> = [];
    for (const entry of pageEntries) {
      for (const media of entry.visibleMedia) {
        items.push({ pageUrl: entry.page.url, media });
      }
    }
    return items;
  }, [pageEntries]);

  const filteredDownloadableMedia = useMemo(
    () => filteredMedia.filter(({ media }) => media.downloadable),
    [filteredMedia],
  );

  const filteredCounts = useMemo(() => {
    let images = 0;
    let videos = 0;
    for (const { media } of filteredMedia) {
      if (media.type === "image") images++;
      else videos++;
    }
    return { images, videos, total: filteredMedia.length };
  }, [filteredMedia]);

  const visibleDownloadableUrls = useMemo(
    () => new Set(filteredDownloadableMedia.map(({ media }) => media.url)),
    [filteredDownloadableMedia],
  );

  useEffect(() => {
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const url of prev) {
        if (visibleDownloadableUrls.has(url)) next.add(url);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleDownloadableUrls]);

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

  const selectAllForPage = useCallback((pageDownloadable: MediaItem[]) => {
    setSelected((prev) => {
      if (pageDownloadable.length === 0) {
        return prev;
      }

      const next = new Set(prev);
      const allSelected = pageDownloadable.every((m) => prev.has(m.url));
      for (const m of pageDownloadable) {
        if (allSelected) next.delete(m.url);
        else next.add(m.url);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected((prev) => {
      if (filteredDownloadableMedia.length === 0) {
        return prev;
      }

      if (prev.size === filteredDownloadableMedia.length) return new Set();
      return new Set(filteredDownloadableMedia.map(({ media }) => media.url));
    });
  }, [filteredDownloadableMedia]);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setAvailabilityFilter("all");
    setMediaTypeFilter("all");
    setPlatformFilter("all");
    setContentKindFilter("all");
    setPageKindFilter("all");
    setConfidenceFilter("all");
    setShowEmptyPages(false);
  }, []);

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
    const items =
      selected.size > 0
        ? filteredDownloadableMedia.filter(({ media }) => selected.has(media.url))
        : filteredDownloadableMedia;
    return items.map(({ media }) => mediaItemToAsset(media)).filter((asset) => asset !== null);
  }, [filteredDownloadableMedia, selected]);

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
      ? `ZIP (${assetsForZip.length} selecionado${assetsForZip.length !== 1 ? "s" : ""})`
      : `ZIP (${filteredDownloadableMedia.length})`;

  const pagesWithVisibleMedia = pageEntries.filter((entry) => entry.visibleMedia.length > 0).length;

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--g-sub)]">
              Busca profunda concluída
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-[var(--g-ink)]">
              {filteredCounts.total} resultado{filteredCounts.total !== 1 ? "s" : ""} visíve
              {filteredCounts.total !== 1 ? "is" : "l"}
            </h2>
            <p className="mt-1 text-sm text-[var(--g-sub)]">
              Exibindo {filteredCounts.total} de {results.totalMedia} mídia{results.totalMedia !== 1 ? "s" : ""} em{" "}
              {pageEntries.length} de {results.pagesCrawled} página{results.pagesCrawled !== 1 ? "s" : ""}.
              {results.pagesWithErrors > 0 && (
                <span className="ml-2 text-xs text-[var(--g-danger)]">({results.pagesWithErrors} com erro)</span>
              )}
            </p>
            {filteredDownloadableMedia.length < filteredMedia.length && (
              <p className="mt-1 text-xs text-[var(--g-muted)]">
                {filteredDownloadableMedia.length} item{filteredDownloadableMedia.length !== 1 ? "s" : ""} baixável
                {filteredDownloadableMedia.length !== 1 ? "eis" : ""}; o restante abre a página original.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={selectAll}
              className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-bold transition-all ${
                selected.size === filteredDownloadableMedia.length && filteredDownloadableMedia.length > 0
                  ? "border-[var(--g-accent-border)] bg-[var(--g-accent-soft)] text-[var(--g-ink)]"
                  : "border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-[var(--g-sub)] hover:text-[var(--g-ink)] hover:border-[var(--g-accent-border)]"
              }`}
              disabled={filteredDownloadableMedia.length === 0}
            >
              {selected.size === filteredDownloadableMedia.length && filteredDownloadableMedia.length > 0 ? (
                <CheckSquare size={14} />
              ) : (
                <Square size={14} />
              )}
              {selected.size === filteredDownloadableMedia.length && filteredDownloadableMedia.length > 0
                ? "Desmarcar tudo"
                : "Selecionar tudo"}
            </button>
            {selected.size > 0 && (
              <span className="rounded-lg bg-[var(--g-accent-soft)] px-2.5 py-1 text-xs font-bold text-[var(--g-ink)]">
                {selected.size}
              </span>
            )}

            {isZipping ? (
              <button
                type="button"
                onClick={() => {
                  zipAbortRef.current?.abort();
                  setIsZipping(false);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] px-4 text-xs font-bold text-[var(--g-danger)] transition-all hover:bg-[rgba(248,113,113,0.12)]"
              >
                <X size={14} />
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDownloadZip}
                disabled={assetsForZip.length === 0}
                className="btn-primary inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold"
              >
                <Package size={14} />
                {zipLabel}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            icon={<ImageIcon className="h-4 w-4" />}
            label="Imagens"
            value={formatStatValue(filteredCounts.images, counts.images)}
            color="text-sky-400"
            bg="bg-sky-500/10"
          />
          <Stat
            icon={<Video className="h-4 w-4" />}
            label="Vídeos"
            value={formatStatValue(filteredCounts.videos, counts.videos)}
            color="text-fuchsia-400"
            bg="bg-fuchsia-500/10"
          />
          <Stat
            icon={<Layers className="h-4 w-4" />}
            label="Páginas"
            value={formatStatValue(pageEntries.length, results.pagesCrawled)}
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

        <div className="mt-5 rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-2)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--g-sub)]">Filtros</p>
              <p className="mt-1 text-sm text-[var(--g-muted)]">
                Refine por página, plataforma, tipo de conteúdo, confiança e disponibilidade.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowEmptyPages((value) => !value)}
                aria-pressed={showEmptyPages}
                className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-bold transition-all ${
                  showEmptyPages
                    ? "border-[var(--g-accent-border)] bg-[var(--g-accent-soft)] text-[var(--g-ink)]"
                    : "border-[var(--g-line)] bg-[var(--g-surface-1)] text-[var(--g-sub)] hover:border-[var(--g-line-hover)] hover:text-[var(--g-ink)]"
                }`}
              >
                {showEmptyPages ? <CheckSquare size={14} /> : <Square size={14} />}
                Mostrar páginas vazias
              </button>

              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-1)] px-4 text-xs font-bold text-[var(--g-sub)] transition-all hover:border-[var(--g-line-hover)] hover:text-[var(--g-ink)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={14} />
                Limpar filtros
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--g-sub)]">Buscar</span>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--g-muted)]"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder="URL, título, plataforma..."
                  className="h-11 w-full rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-1)] pl-9 pr-3 text-sm text-[var(--g-ink)] outline-none transition-colors placeholder:text-[var(--g-muted)] focus:border-[var(--g-accent-border)]"
                />
              </div>
            </label>

            <FilterField
              label="Disponibilidade"
              value={availabilityFilter}
              onChange={(value) => setAvailabilityFilter(value as AvailabilityFilter)}
              options={[
                { value: "all", label: "Todos" },
                { value: "downloadable", label: "Baixáveis" },
                { value: "link_only", label: "Só links" },
              ]}
            />

            <FilterField
              label="Tipo de mídia"
              value={mediaTypeFilter}
              onChange={(value) => setMediaTypeFilter(value as MediaTypeFilter)}
              options={[
                { value: "all", label: "Todos" },
                { value: "image", label: "Imagens" },
                { value: "video", label: "Vídeos" },
              ]}
            />

            <FilterField
              label="Plataforma"
              value={platformFilter}
              onChange={setPlatformFilter}
              options={[
                { value: "all", label: "Todas" },
                ...availablePlatforms.map((platform) => ({
                  value: platform,
                  label: formatPlatformLabel(platform),
                })),
              ]}
            />

            <FilterField
              label="Conteúdo"
              value={contentKindFilter}
              onChange={setContentKindFilter}
              options={[
                { value: "all", label: "Todos" },
                ...availableContentKinds.map((contentKind) => ({
                  value: contentKind,
                  label: formatContentKind(contentKind),
                })),
              ]}
            />

            <FilterField
              label="Tipo de página"
              value={pageKindFilter}
              onChange={setPageKindFilter}
              options={[
                { value: "all", label: "Todas" },
                ...availablePageKinds.map((pageKind) => ({
                  value: pageKind,
                  label: formatPageKind(pageKind),
                })),
              ]}
            />

            <FilterField
              label="Confiança"
              value={confidenceFilter}
              onChange={(value) => setConfidenceFilter(value as ConfidenceFilter)}
              options={[
                { value: "all", label: "Todas" },
                { value: "high", label: "90%+" },
                { value: "medium", label: "75%+" },
                { value: "low", label: "50%+" },
              ]}
            />

            <div className="rounded-xl border border-dashed border-[var(--g-line)] bg-[var(--g-surface-1)] px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--g-sub)]">Resumo</p>
              <p className="mt-1 text-sm font-semibold text-[var(--g-ink)]">
                {pagesWithVisibleMedia} página{pagesWithVisibleMedia !== 1 ? "s" : ""} com mídia visível
              </p>
              <p className="mt-1 text-xs text-[var(--g-muted)]">
                {filteredDownloadableMedia.length} item{filteredDownloadableMedia.length !== 1 ? "s" : ""} baixável
                {filteredDownloadableMedia.length !== 1 ? "eis" : ""} no recorte atual.
              </p>
            </div>
          </div>
        </div>
      </div>

      {zipMsg && (
        <div
          aria-live="polite"
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            zipMsg.type === "ok"
              ? "border border-[var(--g-success-border)] bg-[var(--g-success-bg)] text-[var(--g-success)]"
              : "border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] text-[var(--g-danger)]"
          }`}
        >
          {zipMsg.text}
        </div>
      )}

      {allMedia.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--g-line)] py-14 text-center">
          <p className="text-sm font-medium text-[var(--g-sub)]">
            Nenhuma mídia foi encontrada durante a busca profunda.
          </p>
        </div>
      )}

      {allMedia.length > 0 && pageEntries.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--g-line)] bg-[var(--g-surface-1)] px-6 py-14 text-center">
          <p className="text-base font-semibold text-[var(--g-ink)]">
            Nenhum resultado corresponde aos filtros atuais.
          </p>
          <p className="mt-2 text-sm text-[var(--g-sub)]">
            Ajuste os filtros ou limpe o recorte para voltar a ver todas as mídias encontradas.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] px-4 text-sm font-semibold text-[var(--g-ink)] transition-all hover:border-[var(--g-line-hover)]"
          >
            <RotateCcw size={14} />
            Limpar filtros
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        {pageEntries.map(({ page, idx, visibleMedia, downloadableMedia, pageMatchesSearch }) => {
          const isExpanded = expandedPages.has(idx);
          const hasVisibleMedia = visibleMedia.length > 0;
          const allPageSelected =
            downloadableMedia.length > 0 && downloadableMedia.every((media) => selected.has(media.url));
          const panelId = `crawl-page-panel-${idx}`;
          const pageMediaLabel =
            visibleMedia.length === page.media.length
              ? `${visibleMedia.length}`
              : `${visibleMedia.length}/${page.media.length}`;

          return (
            <div
              key={`${page.url}-${idx}`}
              className={`overflow-hidden rounded-xl border transition-colors ${
                isExpanded && hasVisibleMedia
                  ? "border-[var(--g-line-hover)] bg-[var(--g-surface-1)]"
                  : "border-[var(--g-line)] bg-[var(--g-surface-1)]"
              }`}
            >
              <button
                type="button"
                onClick={() => togglePage(idx)}
                aria-expanded={isExpanded}
                aria-controls={panelId}
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
                  <span className="rounded-md bg-[var(--g-surface-3)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--g-muted)]">
                    {page.depth}
                  </span>

                  <span className="rounded-md bg-[var(--g-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--g-ink)]">
                    {formatPageKind(page.pageKind)}
                  </span>

                  {(hasVisibleMedia || page.media.length > 0) && (
                    <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                      {pageMediaLabel}
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

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    id={panelId}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-[var(--g-line)] px-4 py-4">
                      {(page.discoveredFrom || page.discoveryReason) && (
                        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] px-3 py-2">
                          {page.discoveredFrom && (
                            <span className="text-[11px] text-[var(--g-sub)]">
                              Descoberta em{" "}
                              <span className="font-mono text-[var(--g-muted)]">{compactUrl(page.discoveredFrom)}</span>
                            </span>
                          )}
                          {page.discoveryReason && (
                            <span className="rounded-md bg-[var(--g-surface-3)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--g-muted)]">
                              {formatDiscoveryReason(page.discoveryReason)}
                            </span>
                          )}
                          {pageMatchesSearch && normalizedQuery.length > 0 && visibleMedia.length > 0 && (
                            <span className="rounded-md bg-[var(--g-surface-3)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--g-muted)]">
                              busca bateu na página
                            </span>
                          )}
                        </div>
                      )}

                      {page.media.length > visibleMedia.length && (
                        <p className="mb-4 text-[11px] text-[var(--g-muted)]">
                          Exibindo {visibleMedia.length} de {page.media.length} mídia
                          {page.media.length !== 1 ? "s" : ""} desta página.
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => selectAllForPage(downloadableMedia)}
                        disabled={downloadableMedia.length === 0}
                        className={`mb-4 inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition-all ${
                          allPageSelected
                            ? "border-[var(--g-accent-border)] bg-[var(--g-accent-soft)] text-[var(--g-ink)]"
                            : "border-[var(--g-line)] text-[var(--g-sub)] hover:border-[var(--g-line-hover)] hover:text-[var(--g-ink)]"
                        }`}
                      >
                        {allPageSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                        {allPageSelected ? "Desmarcar" : "Selecionar"} visíveis da página
                      </button>

                      {hasVisibleMedia ? (
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                          {visibleMedia.map((media, i) => (
                            <StableDeepCrawlMediaCard
                              key={media.url}
                              media={media}
                              index={i}
                              selected={media.downloadable && selected.has(media.url)}
                              toggleMedia={toggleMedia}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-[var(--g-line)] bg-[var(--g-surface-2)] px-4 py-5 text-sm text-[var(--g-sub)]">
                          Esta página entrou no recorte atual, mas não possui mídias que correspondam aos filtros.
                        </div>
                      )}

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
      </div>
    </section>
  );
}

const StableDeepCrawlMediaCard = memo(function StableDeepCrawlMediaCard({
  media,
  index,
  selected,
  toggleMedia,
}: {
  media: MediaItem;
  index: number;
  selected: boolean;
  toggleMedia: (url: string) => void;
}) {
  const onToggle = useCallback(() => toggleMedia(media.url), [toggleMedia, media.url]);
  return <DeepCrawlMediaCard media={media} index={index} selected={selected} onToggle={onToggle} />;
});

function FilterField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--g-sub)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-11 w-full rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-1)] px-3 text-sm text-[var(--g-ink)] outline-none transition-colors focus:border-[var(--g-accent-border)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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

function matchesConfidenceFilter(confidence: number | null, filter: ConfidenceFilter): boolean {
  if (filter === "all") return true;
  if (confidence === null) return false;
  if (filter === "high") return confidence >= 0.9;
  if (filter === "medium") return confidence >= 0.75;
  return confidence >= 0.5;
}

function formatStatValue(filtered: number, total: number): number | string {
  return filtered === total ? total : `${filtered}/${total}`;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(DIACRITICS_PATTERN, "").toLowerCase();
}

function formatPlatformLabel(platform: string): string {
  switch (platform) {
    case "youtube":
      return "YouTube";
    case "vimeo":
      return "Vimeo";
    case "twitch":
      return "Twitch";
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "holodex":
      return "Holodex";
    case "dailymotion":
      return "Dailymotion";
    case "bilibili":
      return "Bilibili";
    case "niconico":
      return "Niconico";
    case "twitter":
      return "X/Twitter";
    case "vturb":
      return "VTurb";
    case "direct":
      return "Direto";
    default:
      return platform.charAt(0).toUpperCase() + platform.slice(1);
  }
}

function formatContentKind(kind: MediaContentKind): string {
  switch (kind) {
    case "video":
      return "Vídeo";
    case "live":
      return "Live";
    case "short":
      return "Short";
    case "clip":
      return "Clip";
    case "playlist":
      return "Playlist";
    case "channel":
      return "Canal";
    case "embed":
      return "Embed";
  }
}

function formatPageKind(kind: PageResult["pageKind"]): string {
  switch (kind) {
    case "landing":
      return "Landing";
    case "hub":
      return "Hub";
    case "listing":
      return "Listagem";
    case "media":
      return "Mídia";
    case "platform":
      return "Plataforma";
    case "unknown":
      return "Página";
  }
}

function formatDiscoveryReason(reason: string): string {
  switch (reason) {
    case "content-hub":
      return "hub de conteúdo";
    case "platform-reference":
      return "referência de plataforma";
    case "interactive-destination":
      return "destino interativo";
    case "onclick-navigation":
      return "onclick";
    case "player-config":
      return "config de player";
    case "data-settings-link":
      return "data-settings";
    default:
      return reason.replace(/-/g, " ");
  }
}

function compactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}
