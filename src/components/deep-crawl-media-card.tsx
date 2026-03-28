"use client";

import { Check, Copy, ExternalLink, Image as ImageIcon, Video } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import type { MediaItem } from "@/lib/crawl/types";
import { PlatformIcon } from "./platform-icon";

interface DeepCrawlMediaCardProps {
  media: MediaItem;
  index: number;
  selected: boolean;
  onToggle: () => void;
}

export function DeepCrawlMediaCard({ media, index, selected, onToggle }: DeepCrawlMediaCardProps) {
  const [imgError, setImgError] = useState(false);
  const [copied, setCopied] = useState(false);
  const isVideo = media.type === "video";
  const thumbnailUrl = media.thumbnailUrl ?? (isVideo ? null : media.url);
  const canShowThumbnail = thumbnailUrl && !imgError;

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
      whileHover={{ y: -3 }}
      className={`group relative overflow-hidden rounded-xl border transition-all duration-200 ${
        selected
          ? "border-[var(--g-accent-border)] bg-[var(--g-surface-1)] ring-1 ring-[var(--g-accent-border)]"
          : "border-[var(--g-line)] bg-[var(--g-surface-1)] hover:border-[var(--g-line-hover)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
      }`}
    >
      {/* Selection overlay */}
      <button
        type="button"
        onClick={onToggle}
        className="absolute inset-0 z-10"
        aria-label={selected ? "Desmarcar" : "Selecionar"}
      />

      {/* Checkbox */}
      <div
        className={`absolute left-2.5 top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-lg border transition-all ${
          selected
            ? "border-white/30 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
            : "border-white/20 bg-black/50 backdrop-blur-sm group-hover:border-white/30"
        }`}
      >
        {selected && <Check size={14} className="text-black" strokeWidth={3} />}
      </div>

      {/* Platform badge */}
      {media.platform && media.platform !== "direct" && (
        <div className="absolute right-2.5 top-2.5 z-20 backdrop-blur-md">
          <PlatformIcon platform={media.platform} size={14} showLabel />
        </div>
      )}

      {/* Thumbnail */}
      <div className="relative flex h-40 items-center justify-center overflow-hidden bg-[var(--g-surface-2)]">
        {canShowThumbnail ? (
          <img
            src={thumbnailUrl}
            alt={media.title ?? ""}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-[var(--g-muted)]">
            {isVideo ? <Video size={32} strokeWidth={1} /> : <ImageIcon size={32} strokeWidth={1} />}
            <span className="text-[10px] font-bold uppercase tracking-[0.15em]">{media.type}</span>
          </div>
        )}

        {/* Source tag */}
        <span className="absolute bottom-2 left-2.5 z-20 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/50 backdrop-blur-sm">
          {media.source}
        </span>
      </div>

      {/* Info */}
      <div className="relative z-20 flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {media.title ? (
            <p className="truncate text-xs font-semibold text-[var(--g-ink)]" title={media.title}>
              {media.title}
            </p>
          ) : (
            <p className="truncate font-mono text-[10px] text-[var(--g-muted)]" title={media.url}>
              {media.url}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(media.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="relative z-30 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--g-line)] bg-[var(--g-surface-2)] text-[var(--g-muted)] transition-all hover:border-[var(--g-line-hover)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
          title={copied ? "Copiado!" : "Copiar URL"}
        >
          {copied ? <Check size={12} className="text-[var(--g-success)]" /> : <Copy size={12} />}
        </button>
        <a
          href={media.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="relative z-30 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--g-line)] bg-[var(--g-surface-2)] text-[var(--g-muted)] transition-all hover:border-[var(--g-line-hover)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
          title="Abrir original"
        >
          <ExternalLink size={12} />
        </a>
      </div>
    </motion.article>
  );
}
