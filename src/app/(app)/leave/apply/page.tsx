import { requireViewer } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, PageHeader } from "@/components/ui/kit";
import { ApplyWizard } from "@/modules/leave/components/ApplyWizard";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function Apply() {
  await requireViewer();
  const types = await withUser((db) => db.rows<any>("select code, name, half_day_allowed from leave_types where is_active order by code"));
  return (
    <>
      <PageHeader title="Apply for leave" />
      <Card><ApplyWizard types={types} today={istToday()} /></Card>
    </>
  );
}
