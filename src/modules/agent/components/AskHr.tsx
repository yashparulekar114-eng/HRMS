"use client";
import { useActionState, useRef, useState } from "react";
import { submitLeaveAction } from "@/modules/leave/actions";
import type { ActionState } from "@/lib/actions";
import { btnPrimary, input } from "@/components/ui/kit";

type Draft = { type: string; from: string; to: string; reason: string; half: boolean; period: string | null; weeks: number | null; days: number; lop_days: number; needs_certificate: boolean; routed_to_hr: boolean };
type Msg = { role: "user" | "assistant"; content: string; drafts?: Draft[]; error?: boolean };
const d = (iso: string) => new Date(iso + "T00:00:00+05:30").toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

function DraftCard({ draft }: { draft: Draft }) {
  const [s, act, pending] = useActionState<ActionState, FormData>(submitLeaveAction, {});
  if (s.ok) return <p role="status" className="mt-2 rounded border border-green-200 bg-green-50 p-2 text-sm text-green-900">{s.message}</p>;
  return (
    <form action={act} className="mt-2 rounded border bg-white p-3 text-sm" style={{ borderColor: "var(--border)" }}>
      <p className="font-semibold">Draft (not submitted)</p>
      <p>{draft.type} · {d(draft.from)}{draft.to !== draft.from && ` – ${d(draft.to)}`}{draft.half && ` (${draft.period} half)`} · <b>{draft.days} day(s)</b></p>
      <p className="text-slate-600">“{draft.reason}”</p>
      {draft.routed_to_hr && <p className="text-xs text-slate-600">This goes to HR.</p>}
      {["type", "from", "to", "reason", "period", "weeks"].map((k) => <input key={k} type="hidden" name={k} value={String((draft as any)[k] ?? "")} />)}
      {draft.half && <input type="hidden" name="half" value="on" />}
      {draft.lop_days > 0 && (
        <label className="mt-2 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2">
          <input type="checkbox" name="accept_lop" value="1" required className="mt-1" /> <span>Convert {draft.lop_days} day(s) to Loss of Pay (unpaid).</span>
        </label>
      )}
      {draft.needs_certificate && <input className={`${input} mt-2`} type="file" name="certificate" required accept="application/pdf,image/jpeg,image/png" aria-label="Medical certificate" />}
      <button disabled={pending} className={`${btnPrimary} mt-2`}>{pending ? "Submitting…" : "Confirm and submit"}</button>
      {s.message && !s.ok && <p role="alert" className="mt-1 text-red-700">{s.message}</p>}
    </form>
  );
}

export function AskHr({ firstName, suggestions }: { firstName: string; suggestions: string[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q }]); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q, history }) });
      const j = await r.json();
      setMsgs((m) => [...m, r.ok ? { role: "assistant", content: j.answer, drafts: j.drafts } : { role: "assistant", content: j.error ?? "Something went wrong.", error: true }]);
    } catch { setMsgs((m) => [...m, { role: "assistant", content: "Couldn't reach Ask HR. Check your connection and try again.", error: true }]); }
    finally { setBusy(false); setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="min-h-64 space-y-3 rounded-lg border bg-white p-3" style={{ borderColor: "var(--border)" }} aria-live="polite">
        {msgs.length === 0 && (
          <div>
            <p className="text-sm text-slate-600">Hi {firstName}. Ask about your balance, holidays, how many days a leave will take, or the leave policy. I can draft a request, but you confirm it yourself.</p>
            <div className="mt-2 flex flex-wrap gap-2">{suggestions.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border px-3 py-1 text-xs hover:bg-slate-50">{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <p className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${m.role === "user" ? "text-white" : m.error ? "bg-red-50 text-red-800" : "bg-slate-100"}`} style={m.role === "user" ? { background: "var(--accent)" } : undefined}>{m.content}</p>
            {m.drafts?.map((dr, j) => <DraftCard key={j} draft={dr} />)}
          </div>
        ))}
        {busy && <p className="text-sm text-slate-500">Thinking…</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex gap-2">
        <input className={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={600} placeholder="Ask a question…" aria-label="Your question" />
        <button disabled={busy || !text.trim()} className={btnPrimary}>Send</button>
      </form>
      <p className="text-xs text-slate-500">Ask HR sees your first name, role and location only, never Aadhaar, PAN or bank details. 30 questions a day.</p>
    </div>
  );
}
