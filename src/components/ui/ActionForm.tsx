"use client";
import { useActionState, useRef, type ReactNode } from "react";
import type { ActionState } from "@/lib/actions";

/** A form wired to a server action. Shows the real result (never an optimistic "done") and field errors. */
export function ActionForm({
  action, children, submit, className = "", submitClass = "inline-flex items-center justify-center rounded bg-[var(--interactive)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60",
  resetOnSuccess = false, confirm,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode | ((s: ActionState) => ReactNode);
  submit: string; className?: string; submitClass?: string; resetOnSuccess?: boolean; confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(async (p: ActionState, fd: FormData) => {
    const r = await action(p, fd);
    if (r.ok && resetOnSuccess) ref.current?.reset();
    return r;
  }, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={formAction} className={className}
      onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}>
      {typeof children === "function" ? children(state) : children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={submitClass}>{pending ? "Saving…" : submit}</button>
        {state.message && (
          <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-green-800" : "text-red-700"}`}>{state.message}</p>
        )}
      </div>
    </form>
  );
}
