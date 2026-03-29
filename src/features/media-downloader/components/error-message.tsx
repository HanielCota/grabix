"use client";

import { AlertTriangle, Layers, X } from "lucide-react";
import { motion } from "motion/react";

interface ErrorMessageProps {
  message: string;
  title?: string;
  tone?: "error" | "neutral";
  onDismiss?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function ErrorMessage({ message, title, tone = "error", onDismiss, action }: ErrorMessageProps) {
  const isError = tone === "error";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      className={`rounded-2xl border p-5 ${
        isError
          ? "border-[var(--g-danger-border)] bg-[var(--g-danger-bg)]"
          : "border-[var(--g-line)] bg-[var(--g-surface-1)]"
      }`}
      role={isError ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        <motion.div
          initial={{ rotate: -12 }}
          animate={{ rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            isError ? "bg-[var(--g-danger-bg)] text-[var(--g-danger)]" : "bg-[var(--g-surface-3)] text-[var(--g-sub)]"
          }`}
        >
          {isError ? <AlertTriangle className="h-5 w-5" /> : <Layers className="h-5 w-5" />}
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${isError ? "text-[var(--g-danger)]" : "text-[var(--g-ink)]"}`}>
            {title ?? (isError ? "Erro na análise" : "Nenhuma mídia encontrada")}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--g-sub)]">{message}</p>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[var(--g-line-hover)] bg-[var(--g-surface-3)] px-4 py-2 text-sm font-semibold text-[var(--g-ink)] transition-all hover:bg-[var(--g-line)]"
            >
              <Layers size={15} />
              {action.label}
            </button>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1.5 text-[var(--g-muted)] transition-colors hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
            aria-label={isError ? "Fechar mensagem de erro" : "Fechar mensagem"}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
