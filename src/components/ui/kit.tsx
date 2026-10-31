import type { ReactNode } from "react";

export function Card({ title, children, className = "", action }: { title?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`rounded-lg border bg-white p-4 ${className}`} style={{ borderColor: "var(--border)" }}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold" style={{ color: "var(--primary)" }}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--primary)" }}>{title}</h1>
        {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded border border-dashed p-6 text-center text-sm text-slate-600" style={{ borderColor: "var(--border)" }}>{children}</p>;
}
export function ErrorBox({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{children}</p>;
}
export const btn = "inline-flex items-center justify-center rounded px-3 py-2 text-sm font-semibold text-white disabled:opacity-60";
export const btnPrimary = `${btn} bg-[var(--interactive)] hover:brightness-95`;
export const btnSecondary = "inline-flex items-center justify-center rounded border bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60";
export const btnDanger = `${btn} bg-red-700 hover:brightness-95`;
export const input = "w-full rounded border bg-white px-2 py-2 text-sm focus:outline-2 focus:outline-[var(--accent)]";
export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      {error && <span role="alert" className="mt-0.5 block text-xs text-red-700">{error}</span>}
    </label>
  );
}
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{value}</p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
    </div>
  );
}
