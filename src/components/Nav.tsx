"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string };

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden w-56 shrink-0 flex-col gap-1 p-3 md:flex" style={{ background: "var(--primary)" }}>
      <p className="mb-4 px-2 text-lg font-bold text-white"><span style={{ color: "#f472b6" }}>≈</span> Konkan People</p>
      {items.map((i) => {
        const on = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={`rounded px-3 py-2 text-sm font-medium text-white ${on ? "bg-[var(--interactive)]" : "hover:bg-white/10"}`}>
            <span aria-hidden className="mr-2">{i.icon}</span>{i.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-white md:hidden" style={{ borderColor: "var(--border)" }}>
      {items.map((i) => {
        const on = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className="flex flex-1 flex-col items-center py-2 text-xs font-medium" style={{ color: on ? "var(--accent)" : "#475569" }}>
            <span aria-hidden className="text-lg">{i.icon}</span>{i.label}
          </Link>
        );
      })}
    </nav>
  );
}
