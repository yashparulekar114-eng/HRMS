import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { formatIST } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--primary)" }}>≈ Konkan People</h1>
        <UserButton />
      </div>
      <p className="mt-2 text-sm text-slate-600">{formatIST(new Date(), { dateStyle: "full" })} · IST</p>
      <div className="mt-6 rounded-lg border bg-white p-4" style={{ borderColor: "var(--border)" }}>
        <p className="font-semibold">Checkpoint 3: setup check</p>
        <p className="mt-1 text-sm text-slate-600">HR features arrive from checkpoint 4 onward.</p>
        <Link href="/debug/whoami" className="mt-3 inline-block rounded px-3 py-2 text-sm font-semibold text-white" style={{ background: "var(--interactive)" }}>
          Open /debug/whoami
        </Link>
      </div>
    </main>
  );
}
