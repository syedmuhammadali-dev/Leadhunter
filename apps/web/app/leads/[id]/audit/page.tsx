import { notFound, redirect } from "next/navigation";
import { getLead } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The lead's website audit lives on the business audit page; this keeps old /leads/:id/audit links working. */
export default async function LeadAuditRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLead(id);
  if (!result.ok) notFound();
  redirect(`/businesses/${result.data.businessId}/audit`);
}
