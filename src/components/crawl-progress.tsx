"use client";

import { AlertCircle, CheckCircle2, Globe, Link, Loader2, Video, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo } from "react";
import type { ActivityLogEntry } from "@/lib/crawl/types";

const logEntryInitial = { opacity: 0, x: -8 };
const logEntryAnimate = { opacity: 1, x: 0 };
const logEntryTransition = { duration: 0.15 };

interface CrawlProgressProps {
  pagesDone: number;
  pagesTotal: number;
  mediaFound: number;
  activityLog: ActivityLogEntry[];
  onAbort: () => void;
}

export const CrawlProgress = memo(function CrawlProgress({ pagesDone, pagesTotal, mediaFound, activityLog, onAbort }: CrawlProgressProps) {
  const percentage = pagesTotal > 0 ? Math.round((pagesDone / pagesTotal) * 100) : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--g-line-hover)] bg-[var(--g-surface-1)]">
      {/* Header */}
      <div className="flex items-center justify-between p-5 pb-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--g-surface-3)]">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--g-ink)]" />
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--g-ink)]">Busca profunda em andamento</p>
            <p className="mt-0.5 text-xs text-[var(--g-muted)]">
              {pagesTotal > 0 ? `Analisando página ${pagesDone} de ${pagesTotal}...` : "Descobrindo páginas..."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onAbort}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] px-4 text-xs font-bold text-[var(--g-danger)] transition-all hover:bg-[rgba(248,113,113,0.12)]"
        >
          <X size={14} />
          Cancelar
        </button>
      </div>

      {/* Stats row */}
      <div className="mx-5 mb-4 grid grid-cols-3 gap-2">
        <MiniStat label="Páginas" value={pagesDone} color="text-sky-400" bg="bg-sky-500/10" />
        <MiniStat label="Mídias" value={mediaFound} color="text-emerald-400" bg="bg-emerald-500/10" />
        <MiniStat
          label="Progresso"
          value={`${percentage}%`}
          color="text-[var(--g-ink)]"
          bg="bg-[var(--g-accent-soft)]"
        />
      </div>

      {/* Progress bar */}
      <div className="mx-5 mb-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--g-surface-3)]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Activity log */}
      {activityLog.length > 0 && (
        <div className="border-t border-[var(--g-line)] bg-[var(--g-surface-2)]/50">
          <div className="max-h-44 overflow-y-auto p-3">
            <AnimatePresence initial={false}>
              {activityLog.map((entry) => (
                <LogEntry key={entry.id} entry={entry} />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
});

const LogEntry = memo(function LogEntry({ entry }: { entry: ActivityLogEntry }) {
  return (
    <motion.div
      initial={logEntryInitial}
      animate={logEntryAnimate}
      transition={logEntryTransition}
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--g-surface-3)]/50"
    >
      <ActivityIcon type={entry.type} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--g-sub)]">{entry.message}</span>
      <span className="shrink-0 max-w-32 truncate font-mono text-[10px] text-[var(--g-muted)]">
        {truncateUrl(entry.url)}
      </span>
    </motion.div>
  );
});

function MiniStat({ label, value, color, bg }: { label: string; value: number | string; color: string; bg: string }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-xl ${bg} px-3 py-2`}>
      <span className={`text-lg font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] font-medium text-[var(--g-muted)]">{label}</span>
    </div>
  );
}

function ActivityIcon({ type }: { type: ActivityLogEntry["type"] }) {
  switch (type) {
    case "discovered":
      return <Link size={12} className="shrink-0 text-sky-400/70" />;
    case "processing":
      return <Globe size={12} className="shrink-0 animate-pulse text-[var(--g-sub)]" />;
    case "media_found":
      return <Video size={12} className="shrink-0 text-emerald-400" />;
    case "complete":
      return <CheckCircle2 size={12} className="shrink-0 text-[var(--g-success)]" />;
    case "error":
      return <AlertCircle size={12} className="shrink-0 text-[var(--g-danger)]" />;
  }
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 25 ? `${u.pathname.slice(0, 25)}...` : u.pathname;
    return `${u.hostname}${path}`;
  } catch {
    return url.slice(0, 35);
  }
}
