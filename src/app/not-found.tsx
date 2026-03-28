import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--g-line-hover)] bg-[var(--g-surface-2)]">
          <FileQuestion className="h-7 w-7 text-[var(--g-muted)]" />
        </div>

        <h2 className="text-xl font-bold text-[var(--g-ink)]">Página não encontrada</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--g-sub)]">
          Essa rota não existe. O Grabix só tem uma página, a de baixar mídias.
        </p>

        <Link
          href="/"
          className="btn-primary mt-6 inline-flex h-11 items-center gap-2 rounded-xl px-6 text-sm font-bold"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar pro início
        </Link>
      </div>
    </div>
  );
}
