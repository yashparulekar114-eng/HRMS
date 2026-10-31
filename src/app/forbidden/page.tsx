import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold" style={{ color: "var(--primary)" }}>403: Access denied</h1>
      <p className="mt-2 text-slate-600">Your role does not allow this page. If you need access, ask HR.</p>
      <Link href="/" className="mt-6 inline-block rounded px-3 py-2 text-sm font-semibold text-white" style={{ background: "var(--interactive)" }}>Back to the dashboard</Link>
    </main>
  );
}
