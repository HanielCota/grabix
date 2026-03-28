"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { motion } from "motion/react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md text-center"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)]">
          <AlertTriangle className="h-7 w-7 text-[var(--g-danger)]" />
        </div>

        <h2 className="text-xl font-bold text-[var(--g-ink)]">Algo deu errado</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--g-sub)]">
          Um erro inesperado aconteceu. Pode ser temporário, tenta de novo.
        </p>

        {error.digest && <p className="mt-3 font-mono text-xs text-[var(--g-muted)]">Código: {error.digest}</p>}

        <button
          type="button"
          onClick={reset}
          className="btn-primary mt-6 inline-flex h-11 items-center gap-2 rounded-xl px-6 text-sm font-bold"
        >
          <RotateCcw className="h-4 w-4" />
          Tentar novamente
        </button>
      </motion.div>
    </div>
  );
}
