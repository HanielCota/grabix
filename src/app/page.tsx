"use client";

import { Grab } from "lucide-react";
import { motion } from "motion/react";
import { MediaDownloader } from "@/features/media-downloader/components/media-downloader";
import { ErrorBoundary } from "./error-boundary";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-12 pb-10 sm:px-8 sm:pt-20">
      {/* ── Hero ── */}
      <header className="mb-10 text-center sm:mb-14">
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="mb-5 inline-flex h-20 w-20 items-center justify-center rounded-3xl border border-[var(--g-line-hover)] bg-[var(--g-surface-2)]"
        >
          <Grab className="h-10 w-10 text-[var(--g-ink)]" strokeWidth={1.5} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="text-3xl font-bold tracking-[-0.03em] text-[var(--g-ink)] sm:text-4xl"
        >
          GRABIX
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mx-auto mt-4 max-w-md text-base leading-relaxed text-[var(--g-sub)] sm:text-lg"
        >
          Cola uma URL, o Grabix extrai todas as imagens e vídeos. Baixa um por um ou tudo em ZIP.
        </motion.p>
      </header>

      {/* ── Input + Results ── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <ErrorBoundary
          fallbackTitle="O extrator travou"
          fallbackMessage="Algo quebrou durante a análise. Tenta de novo."
        >
          <MediaDownloader />
        </ErrorBoundary>
      </motion.section>

      {/* ── Footer ── */}
      <footer className="mt-16 border-t border-[var(--g-line)] pt-5 text-center text-sm leading-relaxed text-[var(--g-muted)]">
        Só lê o HTML público. Não pula login, não quebra DRM, não faz mágica.
      </footer>
    </main>
  );
}
