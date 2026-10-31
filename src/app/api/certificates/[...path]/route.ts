import { NextResponse } from "next/server";
import { withUser } from "@/lib/db/server";

// Row-level security decides who may read: the owner, HR, or the approver of a request that cites the file.
export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.map(decodeURIComponent).join("/");
  const row = await withUser((db) => db.one<{ content: Buffer; content_type: string }>("select content, content_type from medical_certificates where path = $1", [path])).catch(() => undefined);
  if (!row) return NextResponse.json({ error: "Not found or not allowed" }, { status: 404 });
  return new NextResponse(new Uint8Array(row.content), { headers: { "Content-Type": row.content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
}
