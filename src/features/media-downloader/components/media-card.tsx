"use client";

import { Check, Copy, Download, ExternalLink, Image as ImageIcon, Loader2, Video } from "lucide-react";
import { motion } from "motion/react";
import { memo, useState } from "react";
import type { MediaAsset } from "../domain/types";

const cardInitial = { opacity: 0, y: 20 };
const cardAnimate = { opacity: 1, y: 0 };
const cardWhileHover = { y: -4 };

interface MediaCardProps {
  asset: MediaAsset;
  index: number;
  selected: boolean;
  onToggle: () => void;
}

export const MediaCard = memo(function MediaCard({ asset, index, selected, onToggle }: MediaCardProps) {
  const [imgError, setImgError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isImage = asset.type === "IMAGE";
  const isSvg = asset.extension === "svg";
  const downloadUrl = `/api/download?url=${encodeURIComponent(asset.url)}&fileName=${encodeURIComponent(asset.fileName)}`;

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(asset.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    setDownloadMessage(null);
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setDownloadMessage(data?.error?.message ?? "Falha ao baixar o arquivo.");
        return;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = asset.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      setDownloadMessage("Falha de conexão ao baixar o arquivo.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <motion.article
      initial={cardInitial}
      animate={cardAnimate}
      transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.4) }}
      whileHover={cardWhileHover}
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
            ? "border-white/30 bg-white"
            : "border-white/20 bg-black/50 backdrop-blur-sm opacity-0 group-hover:opacity-100"
        }`}
      >
        {selected && <Check size={14} className="text-black" strokeWidth={3} />}
      </div>

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
            <span className="text-xs font-bold uppercase tracking-[0.15em]">.{asset.extension}</span>
          </div>
        )}

        <span
          className={`absolute left-2.5 top-2.5 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider backdrop-blur-sm ${
            selected ? "opacity-0" : ""
          } ${isImage ? "bg-sky-500/20 text-sky-300" : "bg-fuchsia-500/20 text-fuchsia-300"}`}
        >
          {asset.extension}
        </span>
      </div>

      {/* Content */}
      <div className="relative z-20 p-3.5">
        <h3 className="truncate text-sm font-semibold text-[var(--g-ink)]" title={asset.fileName}>
          {asset.fileName}
        </h3>
        <p className="mt-1 truncate font-mono text-xs text-[var(--g-muted)]" title={asset.url}>
          {asset.url}
        </p>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="btn-primary relative z-30 inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-bold"
          >
            {downloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Baixando...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Baixar
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="relative z-30 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-[var(--g-muted)] transition-colors hover:border-[var(--g-accent-border)] hover:text-[var(--g-ink)]"
            aria-label={copied ? "URL copiada" : "Copiar URL"}
          >
            {copied ? <Check className="h-4 w-4 text-[var(--g-success)]" /> : <Copy className="h-4 w-4" />}
          </button>
          <a
            href={asset.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="relative z-30 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] text-[var(--g-muted)] transition-colors hover:border-[var(--g-accent-border)] hover:text-[var(--g-ink)]"
            aria-label="Abrir arquivo original"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
        {downloadMessage && <p className="mt-2 text-xs text-[var(--g-danger)]">{downloadMessage}</p>}
      </div>
    </motion.article>
  );
});
