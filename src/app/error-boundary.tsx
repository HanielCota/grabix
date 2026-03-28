"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: React.ErrorInfo) {}

  // ─── Actions ───

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-[var(--g-danger-border)] bg-[var(--g-danger-bg)] p-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--g-danger-bg)]">
            <AlertTriangle className="h-5 w-5 text-[var(--g-danger)]" />
          </div>
          <p className="text-sm font-semibold text-[var(--g-danger)]">
            {this.props.fallbackTitle ?? "Componente travou"}
          </p>
          <p className="mt-1 text-sm text-[var(--g-sub)]">
            {this.props.fallbackMessage ?? "Algo quebrou aqui. Clica pra tentar de novo."}
          </p>
          {this.state.error && (
            <p className="mt-2 font-mono text-xs text-[var(--g-muted)]">{this.state.error.message}</p>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--g-danger-border)] px-4 text-xs font-semibold text-[var(--g-danger)] transition-all hover:bg-[rgba(248,113,113,0.12)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Tentar novamente
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
