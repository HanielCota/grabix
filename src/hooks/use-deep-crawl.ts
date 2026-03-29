"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  crawlCompleteEventSchema,
  crawlErrorEventSchema,
  mediaFoundEventSchema,
  pageCompleteEventSchema,
  pageDiscoveredEventSchema,
  pageErrorEventSchema,
  pageProcessingEventSchema,
} from "@/lib/crawl/schemas";
import type { ActivityLogEntry, CrawlConfig, CrawlResult } from "@/lib/crawl/types";

// ─── State ───

interface DeepCrawlState {
  status: "idle" | "crawling" | "complete" | "error";
  progress: {
    pagesDone: number;
    pagesTotal: number;
    mediaFound: number;
  };
  activityLog: ActivityLogEntry[];
  results: CrawlResult | null;
  error: string | null;
}

const initialState: DeepCrawlState = {
  status: "idle",
  progress: { pagesDone: 0, pagesTotal: 0, mediaFound: 0 },
  activityLog: [],
  results: null,
  error: null,
};

// ─── Actions ───

type Action =
  | { type: "START" }
  | { type: "PAGE_PROCESSING"; pagesDone: number; pagesTotal: number }
  | { type: "MEDIA_FOUND"; count: number }
  | { type: "LOG"; entry: ActivityLogEntry }
  | { type: "COMPLETE"; results: CrawlResult }
  | { type: "ERROR"; error: string }
  | { type: "RESET" };

const MAX_LOG_ENTRIES = 50;

function reducer(state: DeepCrawlState, action: Action): DeepCrawlState {
  switch (action.type) {
    case "START":
      return { ...initialState, status: "crawling" };

    case "PAGE_PROCESSING":
      return {
        ...state,
        progress: {
          ...state.progress,
          pagesDone: action.pagesDone,
          pagesTotal: action.pagesTotal,
        },
      };

    case "MEDIA_FOUND":
      return {
        ...state,
        progress: {
          ...state.progress,
          mediaFound: state.progress.mediaFound + action.count,
        },
      };

    case "LOG": {
      const log = [action.entry, ...state.activityLog].slice(0, MAX_LOG_ENTRIES);
      return { ...state, activityLog: log };
    }

    case "COMPLETE":
      return {
        ...state,
        status: "complete",
        results: action.results,
      };

    case "ERROR":
      return {
        ...state,
        status: "error",
        error: action.error,
      };

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

// ─── Hook ───

export interface UseDeepCrawlReturn {
  status: DeepCrawlState["status"];
  progress: DeepCrawlState["progress"];
  activityLog: ActivityLogEntry[];
  results: CrawlResult | null;
  error: string | null;
  startCrawl: (url: string, config: Partial<CrawlConfig>) => void;
  abort: () => void;
  reset: () => void;
}

function createLogEntry(type: ActivityLogEntry["type"], url: string, message: string): ActivityLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    url,
    message,
    timestamp: Date.now(),
  };
}

export function useDeepCrawl(): UseDeepCrawlReturn {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const startCrawl = useCallback((url: string, config: Partial<CrawlConfig>) => {
    // Abort any existing crawl
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: "START" });

    // Start streaming fetch
    startSSEStream(url, config, controller, dispatch);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "ERROR", error: "Crawl cancelado pelo usuário." });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "RESET" });
  }, []);

  return {
    status: state.status,
    progress: state.progress,
    activityLog: state.activityLog,
    results: state.results,
    error: state.error,
    startCrawl,
    abort,
    reset,
  };
}

// ─── SSE Stream Processing ───

async function startSSEStream(
  url: string,
  config: Partial<CrawlConfig>,
  controller: AbortController,
  dispatch: React.Dispatch<Action>,
) {
  try {
    const response = await fetch("/api/extract/deep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, config }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: { message: "Erro desconhecido" } }));
      dispatch({ type: "ERROR", error: data.error?.message ?? `HTTP ${response.status}` });
      return;
    }

    if (!response.body) {
      dispatch({ type: "ERROR", error: "Streaming não suportado pelo navegador." });
      return;
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;

      // Parse SSE events (split by double newline)
      const parts = buffer.split("\n\n");
      // Keep the last incomplete part in buffer
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;
        processSSEEvent(part, dispatch);
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      processSSEEvent(buffer, dispatch);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    dispatch({ type: "ERROR", error: `Falha na conexão: ${message}` });
  }
}

function processSSEEvent(raw: string, dispatch: React.Dispatch<Action>) {
  let eventName = "";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) {
      eventName = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6));
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5));
    }
  }

  if (!eventName || dataLines.length === 0) return;

  // Join all data: lines (handles multi-line SSE data)
  const dataStr = dataLines.join("\n");

  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return;
  }

  switch (eventName) {
    case "crawl_started":
      // Acknowledged — no action needed
      break;

    case "page_discovered": {
      const parsed = pageDiscoveredEventSchema.safeParse(data);
      if (!parsed.success) return;
      const sourceLabel = formatDiscoverySource(parsed.data.source);
      const reason = parsed.data.discoveryReason ? ` • ${formatDiscoveryReason(parsed.data.discoveryReason)}` : "";
      dispatch({
        type: "LOG",
        entry: createLogEntry(
          "discovered",
          parsed.data.url,
          `Página descoberta via ${sourceLabel} (depth ${parsed.data.depth})${reason}`,
        ),
      });
      break;
    }

    case "page_processing": {
      const parsed = pageProcessingEventSchema.safeParse(data);
      if (!parsed.success) return;
      dispatch({
        type: "PAGE_PROCESSING",
        pagesDone: parsed.data.pagesDone,
        pagesTotal: parsed.data.pagesTotal,
      });
      dispatch({
        type: "LOG",
        entry: createLogEntry("processing", parsed.data.url, "Analisando página..."),
      });
      break;
    }

    case "media_found": {
      const parsed = mediaFoundEventSchema.safeParse(data);
      if (!parsed.success) return;
      dispatch({ type: "MEDIA_FOUND", count: 1 });
      const label = parsed.data.media.platform ?? parsed.data.media.type;
      dispatch({
        type: "LOG",
        entry: createLogEntry("media_found", parsed.data.pageUrl, `${label} encontrado`),
      });
      break;
    }

    case "page_complete": {
      const parsed = pageCompleteEventSchema.safeParse(data);
      if (!parsed.success) return;
      dispatch({
        type: "LOG",
        entry: createLogEntry("complete", parsed.data.url, `${parsed.data.mediaCount} mídia(s) encontrada(s)`),
      });
      break;
    }

    case "page_error": {
      const parsed = pageErrorEventSchema.safeParse(data);
      if (!parsed.success) return;
      dispatch({
        type: "LOG",
        entry: createLogEntry("error", parsed.data.url, `Erro: ${parsed.data.error}`),
      });
      break;
    }

    case "crawl_complete": {
      const parsed = crawlCompleteEventSchema.safeParse(data);
      if (!parsed.success) return;
      const results: CrawlResult = {
        originalUrl: parsed.data.originalUrl,
        pagesCrawled: parsed.data.totalPages,
        pagesWithErrors: parsed.data.pagesWithErrors,
        totalMedia: parsed.data.totalMedia,
        results: parsed.data.results,
        crawlDurationMs: parsed.data.crawlDurationMs,
      };
      dispatch({ type: "COMPLETE", results });
      break;
    }

    case "crawl_error": {
      const parsed = crawlErrorEventSchema.safeParse(data);
      if (!parsed.success) return;
      dispatch({ type: "ERROR", error: parsed.data.error });
      break;
    }
  }
}

function formatDiscoverySource(source: string): string {
  switch (source) {
    case "anchor":
      return "link";
    case "button":
      return "botão";
    case "data_attr":
      return "atributo";
    case "data_settings":
      return "configuração";
    case "onclick":
      return "onclick";
    default:
      return "origem";
  }
}

function formatDiscoveryReason(reason: string): string {
  switch (reason) {
    case "content-hub":
      return "hub de conteúdo";
    case "platform-reference":
      return "referência de plataforma";
    case "interactive-destination":
      return "destino interativo";
    case "onclick-navigation":
      return "navegação programática";
    case "player-config":
      return "configuração de player";
    case "data-settings-link":
      return "link em data-settings";
    default:
      return reason.replace(/-/g, " ");
  }
}
