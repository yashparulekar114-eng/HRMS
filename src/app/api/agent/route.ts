import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { DbError, withUser } from "@/lib/db/server";
import { runAgent, startQuestion } from "@/modules/agent/agent";

export const maxDuration = 60;
const Body = z.object({ message: z.string().min(1).max(600), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(12).default([]) });

export async function POST(req: Request) {
  const s = await getViewerState();
  if (s.kind !== "ok") return NextResponse.json({ error: "Not signed in as an employee." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type a question (up to 600 characters)." }, { status: 400 });

  // The question is created, and the 30-a-day cap enforced, BEFORE any model call.
  let questionId: string;
  try { questionId = await startQuestion(); }
  catch (e) {
    if (e instanceof DbError && e.code === "P0429") return NextResponse.json({ error: e.message, limit: true }, { status: 429 });
    return NextResponse.json({ error: "Ask HR is unavailable right now. Try again in a minute." }, { status: 503 });
  }
  const location = await withUser((db) => db.one<{ name: string }>("select l.name from employees e join locations l on l.id = e.location_id where e.id = me()")).then((r) => r?.name ?? "").catch(() => "");
  try {
    const out = await runAgent({ questionId, viewer: s.viewer, cache: new Map(), drafts: [] }, location, parsed.data.history, parsed.data.message);
    return NextResponse.json({ answer: out.text || "I could not find an answer. Please ask HR.", drafts: out.drafts });
  } catch {
    return NextResponse.json({ error: "Ask HR could not answer just now (the AI service is busy). Your question was not lost; please try again shortly." }, { status: 503 });
  }
}
