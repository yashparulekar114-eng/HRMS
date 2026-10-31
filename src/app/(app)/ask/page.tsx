import { requireViewer } from "@/lib/auth/viewer";
import { Card, PageHeader } from "@/components/ui/kit";
import { AskHr } from "@/modules/agent/components/AskHr";

export const dynamic = "force-dynamic";

export default async function Ask() {
  const v = await requireViewer();
  const suggestions = ["What's my leave balance?", "Holidays in December?", "How many days is Friday to Monday?", "Mera CL kitna bacha hai?"];
  return (
    <>
      <PageHeader title="Ask HR" subtitle="Questions about your leave, holidays and policy" />
      <Card><AskHr firstName={v.firstName} suggestions={suggestions} /></Card>
    </>
  );
}
