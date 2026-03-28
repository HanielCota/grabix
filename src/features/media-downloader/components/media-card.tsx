"use client";

import { Download, ExternalLink, Image as ImageIcon, Video } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import type { MediaAsset } from "../domain/types";

interface MediaCardProps {
  asset: MediaAsset;
  index: number;
}

export function MediaCard({ asset, index }: MediaCardProps) {
  const [imgError, setImgError] = useState(false);
  const isImage = asset.type === "IMAGE";
  const isSvg = asset.extension === "svg";
  const downloadUrl = `/api/download?url=${encodeURIComponent(asset.url)}&fileName=${encodeURIComponent(asset.fileName)}`;

  // ─── Render ───

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.4) }}
      whileHover={{ y: -4 }}
      className="group overflow-hidden rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-1)] transition-shadow duration-200 hover:border-[var(--g-line-hover)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
    >
      {/* Preview */}
      <div className="relative flex h-48 items-center justify-center overflow-hidden bg-[var(--g-surface-2)]">
        {isImage && !isSvg && !imgError ? (
          <img
            src={asset.url}
            alt={asset.fileName}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-[var(--g-muted)]">
            {isImage ? (
              <ImageIcon className="h-8 w-8" strokeWidth={1.2} />
            ) : (
              <Video className="h-8 w-8" strokeWidth={1.2} />
            )}
            <span className="text-[10px] font-bold uppercase tracking-[0.15em]">.{asset.extension}</span>
          </div>
        )}

        <span
          className={`absolute left-2.5 top-2.5 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm ${
            isImage ? "bg-sky-500/20 text-sky-300" : "bg-fuchsia-500/20 text-fuchsia-300"
          }`}
        >
          {asset.extension}
        </span>
      </div>

      {/* Content */}
      <div className="p-3.5">
        <h3 className="truncate text-sm font-semibold text-[var(--g-ink)]" title={asset.fileName}>
          {asset.fileName}
        </h3>
        <p className="mt-1 truncate font-mono text-[11px] text-[var(--g-muted)]" title={asset.url}>
          {asset.url}
        </p>

        <div className="mt-3 flex gap-2">
          <a
            href={downloadUrl}
            download={asset.fileName}
            className="btn-primary inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-bold"
          >
            <Download className="h-4 w-4" />
            Baixar
          </a>
          <a
            href={asset.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-[var(--g-muted)] transition-colors hover:border-[var(--g-accent-border)] hover:text-[var(--g-ink)]"
            title="Abrir original"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </motion.article>
  );
}
