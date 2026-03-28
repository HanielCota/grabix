"use client";

import { Globe, Grab, Shield, Zap } from "lucide-react";
import { motion } from "motion/react";
import { MediaDownloader } from "@/features/media-downloader/components/media-downloader";
import { ErrorBoundary } from "./error-boundary";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-5 pt-16 pb-10 sm:px-8 sm:pt-24">
      {/* ── Hero ── */}
      <header className="text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--g-line-hover)] bg-[var(--g-surface-2)]"
        >
          <Grab className="h-7 w-7 text-[var(--g-ink)]" strokeWidth={1.5} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-6xl font-bold tracking-[-0.04em] sm:text-7xl lg:text-8xl"
        >
          GRABIX
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-5 max-w-lg text-lg font-extralight leading-relaxed text-[var(--g-sub)] sm:text-xl"
        >
          Cola a URL de qualquer página pública, o Grabix varre o HTML e puxa todas as imagens e vídeos. Baixa um por um
          ou tudo em ZIP.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-7 flex flex-wrap items-center justify-center gap-3"
        >
          <Badge icon={<Globe className="h-3.5 w-3.5" />} text="Qualquer site" />
          <Badge icon={<Zap className="h-3.5 w-3.5" />} text="Leva segundos" />
          <Badge icon={<Shield className="h-3.5 w-3.5" />} text="Sem cadastro" />
        </motion.div>
      </header>

      {/* ── Input + Results ── */}
      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="mt-12"
      >
        <ErrorBoundary
          fallbackTitle="O extrator travou"
          fallbackMessage="Algo quebrou durante a análise. Tenta de novo."
        >
          <MediaDownloader />
        </ErrorBoundary>
      </motion.section>

      {/* ── Footer ── */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.8 }}
        className="mt-16 border-t border-[var(--g-line)] pt-6 text-center text-sm leading-relaxed text-[var(--g-muted)]"
      >
        Só lê o HTML público. Não pula login, não quebra DRM, não faz mágica.
      </motion.footer>
    </main>
  );
}

// ─── Badge ───

function Badge({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--g-line)] bg-[var(--g-surface-2)] px-4 py-2 text-sm font-medium text-[var(--g-sub)]">
      <span className="text-[var(--g-ink)]">{icon}</span>
      {text}
    </span>
  );
}
