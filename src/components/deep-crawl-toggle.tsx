"use client";

import { ChevronDown, Layers, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { CrawlConfig } from "@/lib/crawl/types";

type PartialConfig = Pick<CrawlConfig, "maxDepth" | "maxPages" | "followExternal">;

interface DeepCrawlToggleProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  config: PartialConfig;
  onConfigChange: (config: PartialConfig) => void;
}

export function DeepCrawlToggle({ enabled, onEnabledChange, config, onConfigChange }: DeepCrawlToggleProps) {
  const [showOptions, setShowOptions] = useState(false);
  const optionsId = "deep-crawl-options";

  return (
    <div className="space-y-2">
      {/* Main toggle */}
      <button
        type="button"
        onClick={() => {
          const next = !enabled;
          onEnabledChange(next);
          if (!next) setShowOptions(false);
        }}
        aria-pressed={enabled}
        className={`mx-auto flex items-center gap-2.5 rounded-xl border px-4 py-2.5 transition-all ${
          enabled
            ? "border-[var(--g-accent-border)] bg-[var(--g-accent-soft)]"
            : "border-[var(--g-line)] bg-[var(--g-surface-2)] hover:border-[var(--g-line-hover)] hover:bg-[var(--g-surface-3)]"
        }`}
      >
        <span
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
            enabled ? "bg-[var(--g-accent)]" : "bg-[var(--g-line-hover)]"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full shadow-sm transition-all duration-200 ${
              enabled ? "translate-x-4.5 bg-[var(--g-accent-text)]" : "translate-x-0.5 bg-white/80"
            }`}
          />
        </span>
        <Layers size={15} className={enabled ? "text-[var(--g-ink)]" : "text-[var(--g-muted)]"} />
        <span className={`text-sm font-semibold ${enabled ? "text-[var(--g-ink)]" : "text-[var(--g-sub)]"}`}>
          Busca profunda
        </span>
        <span className={`hidden text-xs sm:inline ${enabled ? "text-[var(--g-sub)]" : "text-[var(--g-muted)]"}`}>
          Segue links para encontrar mais mídias
        </span>
      </button>

      {/* Advanced options */}
      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              aria-controls={optionsId}
              className="mx-auto flex items-center gap-2 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-2)] px-4 py-2 text-sm font-medium text-[var(--g-sub)] transition-all hover:border-[var(--g-line-hover)] hover:bg-[var(--g-surface-3)] hover:text-[var(--g-ink)]"
            >
              <SlidersHorizontal size={15} />
              Configurações
              <ChevronDown
                size={15}
                className={`transition-transform duration-200 ${showOptions ? "rotate-180" : ""}`}
              />
            </button>

            <AnimatePresence>
              {showOptions && (
                <motion.div
                  id={optionsId}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mx-auto mt-3 max-w-md space-y-5 rounded-xl border border-[var(--g-line)] bg-[var(--g-surface-1)] p-5">
                    <RangeOption
                      label="Profundidade"
                      value={config.maxDepth}
                      min={1}
                      max={3}
                      onChange={(v) => onConfigChange({ ...config, maxDepth: v })}
                    />
                    <RangeOption
                      label="Máximo de páginas"
                      value={config.maxPages}
                      min={5}
                      max={50}
                      step={5}
                      onChange={(v) => onConfigChange({ ...config, maxPages: v })}
                    />
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--g-surface-2)]">
                      <span className="text-sm font-medium text-[var(--g-sub)]">Seguir links externos</span>
                      <span
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          config.followExternal ? "bg-[var(--g-accent)]" : "bg-[var(--g-line-hover)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={config.followExternal}
                          onChange={(e) => onConfigChange({ ...config, followExternal: e.target.checked })}
                          className="sr-only"
                        />
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full shadow-sm transition-all ${
                            config.followExternal
                              ? "translate-x-4.5 bg-[var(--g-accent-text)]"
                              : "translate-x-0.5 bg-white/80"
                          }`}
                        />
                      </span>
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RangeOption({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--g-sub)]">{label}</span>
        <span className="rounded-lg bg-[var(--g-surface-3)] px-2.5 py-1 text-sm font-bold tabular-nums text-[var(--g-ink)]">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--g-accent)]"
      />
      <div className="flex justify-between text-xs text-[var(--g-muted)]">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
