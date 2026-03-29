"use client";

import { Check, Copy, ExternalLink, Image as ImageIcon, Video } from "lucide-react";
import { motion } from "motion/react";
import { memo, useState } from "react";
import type { MediaItem } from "@/lib/crawl/types";
import { PlatformIcon } from "./platform-icon";

const cardInitial = { opacity: 0, y: 16 };
const cardAnimate = { opacity: 1, y: 0 };
const cardWhileHover = { y: -3 };

interface DeepCrawlMediaCardProps {
  media: MediaItem;
  index: number;
  selected: boolean;
  onToggle: () => void;
}

export const DeepCrawlMediaCard = memo(function DeepCrawlMediaCard({
  media,
  index,
  selected,
  onToggle,
}: DeepCrawlMediaCardProps) {
  const [imgError, setImgError] = useState(false);
  const [copied, setCopied] = useState(false);
  const isVideo = media.type === "video";
  const isSelectable = media.downloadable;
  const externalUrl = media.canonicalUrl ?? media.url;
  const thumbnailUrl = media.thumbnailUrl ?? (isVideo ? null : media.url);
  const canShowThumbnail = thumbnailUrl && !imgError;
  const confidence = media.confidence !== null ? Math.round(media.confidence * 100) : null;

  return (
    <motion.article
      initial={cardInitial}
      animate={cardAnimate}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
      whileHover={cardWhileHover}
      className={`group relative overflow-hidden rounded-xl border transition-all duration-200 ${
        selected && isSelectable
          ? "border-[var(--g-accent-border)] bg-[var(--g-surface-1)] ring-1 ring-[var(--g-accent-border)]"
          : "border-[var(--g-line)] bg-[var(--g-surface-1)] hover:border-[var(--g-line-hover)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
      }`}
    >
      {/* Selection overlay */}
      {isSelectable && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute inset-0 z-10"
          aria-label={selected ? "Desmarcar item" : "Selecionar item"}
        />
      )}

      {/* Checkbox */}
      {isSelectable && (
        <div
          className={`absolute left-2.5 top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-lg border transition-all ${
            selected
              ? "border-white/30 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
              : "border-white/20 bg-black/50 backdrop-blur-sm group-hover:border-white/30"
          }`}
        >
          {selected && <Check size={14} className="text-black" strokeWidth={3} />}
        </div>
      )}

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
            alt={media.title ?? `Prévia de ${media.platform ?? media.type}`}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-[var(--g-muted)]">
            {isVideo ? <Video size={32} strokeWidth={1} /> : <ImageIcon size={32} strokeWidth={1} />}
            <span className="text-xs font-bold uppercase tracking-[0.15em]">{media.type}</span>
          </div>
        )}

        {/* Source tag */}
        <span className="absolute bottom-2 left-2.5 z-20 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-white/60 backdrop-blur-sm">
          {media.source}
        </span>
        {!isSelectable && (
          <span className="absolute bottom-2 right-2.5 z-20 rounded-md bg-[var(--g-surface-1)]/90 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--g-sub)] backdrop-blur-sm">
            Só link
          </span>
        )}
      </div>

      {/* Info */}
      <div className="relative z-20 flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {media.title ? (
            <p className="truncate text-sm font-semibold text-[var(--g-ink)]" title={media.title}>
              {media.title}
            </p>
          ) : (
            <p className="truncate font-mono text-xs text-[var(--g-muted)]" title={externalUrl}>
              {externalUrl}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {media.contentKind && (
              <span className="rounded-md bg-[var(--g-surface-2)] px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-[var(--g-sub)]">
                {formatContentKind(media.contentKind)}
              </span>
            )}
            {confidence !== null && (
              <span className="rounded-md bg-[var(--g-accent-soft)] px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-[var(--g-ink)]">
                {confidence}% confiança
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(externalUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="relative z-30 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--g-line)] bg-[var(--g-surface-2)] text-[var(--g-muted)] transition-all hover:border-[var(--g-line-hover)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
          aria-label={copied ? "URL copiada" : "Copiar URL"}
        >
          {copied ? <Check size={12} className="text-[var(--g-success)]" /> : <Copy size={12} />}
        </button>
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="relative z-30 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--g-line)] bg-[var(--g-surface-2)] text-[var(--g-muted)] transition-all hover:border-[var(--g-line-hover)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
          aria-label="Abrir página original"
        >
          <ExternalLink size={12} />
        </a>
      </div>
    </motion.article>
  );
});

function formatContentKind(kind: NonNullable<MediaItem["contentKind"]>): string {
  switch (kind) {
    case "video":
      return "video";
    case "live":
      return "live";
    case "short":
      return "short";
    case "clip":
      return "clip";
    case "playlist":
      return "playlist";
    case "channel":
      return "channel";
    case "embed":
      return "embed";
  }
}
