"use client";

import { AlertTriangle, X } from "lucide-react";
import { motion } from "motion/react";

interface ErrorMessageProps {
  message: string;
  onDismiss?: () => void;
}

export function ErrorMessage({ message, onDismiss }: ErrorMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] p-5"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <motion.div
          initial={{ rotate: -12 }}
          animate={{ rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--g-danger-bg)] text-[var(--g-danger)]"
        >
          <AlertTriangle className="h-5 w-5" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--g-danger)]">Erro na análise</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--g-sub)]">{message}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1.5 text-[var(--g-muted)] transition-colors hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
            aria-label="Fechar erro"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
