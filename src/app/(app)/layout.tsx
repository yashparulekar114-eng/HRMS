import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { BottomNav, SideNav, type NavItem } from "@/components/Nav";
import { getViewerState } from "@/lib/auth/viewer";
import { formatIST } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getViewerState();
  if (s.kind !== "ok") redirect("/no-access");
  const v = s.viewer;
  const items: NavItem[] = [
    { href: "/", label: "Dashboard", icon: "⌂" },
    { href: "/attendance", label: "Attendance", icon: "◷" },
    { href: "/leave", label: "My Leave", icon: "✈" },
    ...(v.isManager || v.isHr ? [{ href: "/approvals", label: "Approvals", icon: "✓" }] : []),
    ...(v.isHr ? [{ href: "/employees", label: "Employees", icon: "☰" }] : []),
    ...(v.isManager || v.isHr ? [{ href: "/reports", label: "Reports", icon: "▤" }] : []),
    { href: "/ask", label: "Ask HR", icon: "✎" },
    ...(v.isHr ? [{ href: "/settings", label: "Settings", icon: "⚙" }] : []),
  ];
  const mobile = items.filter((i) => ["/", "/attendance", "/leave", "/ask"].includes(i.href));
  return (
    <div className="flex min-h-screen">
      <SideNav items={items} />
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <header className="flex items-center justify-between border-b bg-white px-4 py-2" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm text-slate-600">{formatIST(new Date(), { dateStyle: "full" })} · IST</p>
          <div className="flex items-center gap-3">
            <a href="/profile" className="text-sm font-medium" style={{ color: "var(--interactive)" }}>{v.fullName}</a>
            <UserButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</main>
      </div>
      <BottomNav items={mobile} />
    </div>
  );
}
