// Status tokens from DESIGN.md. Every cell shows a letter, code or icon, never colour alone.
export type DayInfo = {
  status: string; buckets: Record<string, number>; late?: boolean; leave?: string[]; label?: string; hours?: number;
  check_in?: string; check_out?: string; is_wfh?: boolean;
};

const T = {
  present: { bg: "#DCFCE7", fg: "#166534" },
  half: { bg: "#FEF3C7", fg: "#92400E" },
  absent: { bg: "#FEE2E2", fg: "#991B1B" },
  leave: { bg: "#DBEAFE", fg: "#1E40AF" },
  holiday: { bg: "#EDE9FE", fg: "#5B21B6" },
  off: { bg: "#F1F5F9", fg: "#475569" },
  pending: { bg: "#FCE7F3", fg: "#9D174D" },
  none: { bg: "#FFFFFF", fg: "#64748B" },
};

export function dayStyle(i: DayInfo) {
  switch (i.status) {
    case "Present": return { ...T.present, text: "P", name: "Present" };
    case "WFH": return { ...T.present, text: "⌂ P", name: "Work from home" };
    case "Half Day": return { ...T.half, text: "H", name: "Half day" };
    case "Absent": return { ...T.absent, text: "A", name: "Absent" };
    case "On Leave": {
      const half = (i.buckets.Present ?? 0) + (i.buckets.WFH ?? 0) + (i.buckets.Absent ?? 0) > 0;
      const code = (i.leave ?? [])[0] ?? "L";
      return { ...T.leave, text: code + (half ? " ½" : ""), name: "On leave " + code,
        split: half ? ((i.buckets.Absent ?? 0) > 0 ? T.absent.bg : T.present.bg) : undefined };
    }
    case "Holiday": return { ...T.holiday, text: "Hol", name: i.label ?? "Holiday" };
    case "Weekly Off": return { ...T.off, text: "WO", name: "Weekly off" };
    case "Pending Regularisation": return { ...T.pending, text: "?", name: "Pending regularisation", dashed: true };
    case "In progress": return { ...T.present, text: "…", name: "Checked in" };
    default: return { ...T.none, text: "", name: i.status };
  }
}

export function DayCell({ day, info, wide = false }: { day: number | string; info: DayInfo; wide?: boolean }) {
  const s = dayStyle(info) as ReturnType<typeof dayStyle> & { split?: string; dashed?: boolean };
  return (
    <div
      title={`${day}: ${s.name}${info.late ? " (Late)" : ""}`}
      aria-label={`${day}: ${s.name}${info.late ? ", late" : ""}`}
      className={`relative flex flex-col items-center justify-center rounded text-xs font-semibold ${wide ? "h-14 w-full" : "h-9 w-9"}`}
      style={{
        background: s.split ? `linear-gradient(135deg, ${s.bg} 50%, ${s.split} 50%)` : s.bg,
        color: s.fg,
        border: s.dashed ? "1.5px dashed #9D174D" : "1px solid #E2E8F0",
      }}
    >
      {wide && <span className="text-[10px] font-normal opacity-70">{day}</span>}
      <span>{s.text}</span>
      {info.late && (
        <span aria-hidden className="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-bl text-[9px] text-white" style={{ background: "#C2410C" }}>L</span>
      )}
    </div>
  );
}

export function Legend() {
  const items: [string, ReturnType<typeof dayStyle>][] = [
    ["Present", dayStyle({ status: "Present", buckets: {} })], ["Half day", dayStyle({ status: "Half Day", buckets: {} })],
    ["Absent", dayStyle({ status: "Absent", buckets: {} })], ["On leave", dayStyle({ status: "On Leave", buckets: {}, leave: ["CL"] })],
    ["Holiday", dayStyle({ status: "Holiday", buckets: {} })], ["Weekly off", dayStyle({ status: "Weekly Off", buckets: {} })],
    ["Pending regularisation", dayStyle({ status: "Pending Regularisation", buckets: {} })],
  ];
  return (
    <ul className="flex flex-wrap gap-2 text-xs">
      {items.map(([n, s]) => (
        <li key={n} className="flex items-center gap-1">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-semibold" style={{ background: s.bg, color: s.fg }}>{s.text}</span> {n}
        </li>
      ))}
      <li className="flex items-center gap-1"><span className="inline-flex h-5 w-5 items-center justify-center rounded text-white" style={{ background: "#C2410C" }}>L</span> Late</li>
    </ul>
  );
}

const REQ: Record<string, { bg: string; fg: string }> = {
  Pending: { bg: "#FEF3C7", fg: "#92400E" }, Approved: { bg: "#DCFCE7", fg: "#166534" },
  Rejected: { bg: "#FEE2E2", fg: "#991B1B" }, Cancelled: { bg: "#F1F5F9", fg: "#475569" },
};
export function RequestBadge({ status }: { status: string }) {
  const s = REQ[status] ?? REQ.Cancelled;
  return <span className="rounded px-2 py-0.5 text-xs font-semibold" style={{ background: s.bg, color: s.fg }}>{status}</span>;
}
