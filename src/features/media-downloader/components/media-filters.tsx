"use client";

import { Image as ImageIcon, LayoutGrid, Video } from "lucide-react";
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
    <div className="inline-flex gap-1 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-1">
      {FILTERS.map(({ value, label, icon }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(value)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
              isActive
                ? "btn-primary text-white shadow-sm"
                : "text-[var(--g-muted)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
            }`}
          >
            {icon}
            {label}
            <span
              className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                isActive ? "bg-white/20 text-white" : "bg-[var(--g-surface-3)] text-[var(--g-muted)]"
              }`}
            >
              {counts[value]}
            </span>
          </button>
        );
      })}
    </div>
  );
});
