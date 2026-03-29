"use client";

import { Image as ImageIcon, LayoutGrid, Video } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo } from "react";

export type FilterType = "all" | "IMAGE" | "VIDEO";

interface MediaFiltersProps {
  active: FilterType;
  onChange: (filter: FilterType) => void;
  counts: { all: number; IMAGE: number; VIDEO: number };
}

const FILTERS: { value: FilterType; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "Todos", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  { value: "IMAGE", label: "Imagens", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { value: "VIDEO", label: "Vídeos", icon: <Video className="h-3.5 w-3.5" /> },
];

export const MediaFilters = memo(function MediaFilters({ active, onChange, counts }: MediaFiltersProps) {
  return (
    <div className="inline-flex gap-1 rounded-2xl border border-[var(--g-line)] bg-[var(--g-surface-1)]/80 p-1 backdrop-blur-sm">
      {FILTERS.map(({ value, label, icon }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(value)}
            className="relative inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors"
          >
            {isActive && (
              <motion.span
                layoutId="media-filter-pill"
                className="absolute inset-0 rounded-xl bg-[var(--g-accent)] shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.12)]"
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
            <span
              className={`relative z-10 flex items-center gap-1.5 transition-colors duration-200 ${
                isActive ? "text-[var(--g-accent-text)]" : "text-[var(--g-muted)] hover:text-[var(--g-ink)]"
              }`}
            >
              {icon}
              {label}
              <AnimatePresence mode="wait">
                <motion.span
                  key={counts[value]}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                    isActive
                      ? "bg-[var(--g-accent-text)]/15 text-[var(--g-accent-text)]"
                      : "bg-[var(--g-surface-3)] text-[var(--g-muted)]"
                  }`}
                >
                  {counts[value]}
                </motion.span>
              </AnimatePresence>
            </span>
          </button>
        );
      })}
    </div>
  );
});
