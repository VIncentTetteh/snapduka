import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function dotClass(action: string) {
  if (action.includes("approved") || action.includes("paid") || action.includes("resolved")) {
    return "bg-success";
  }
  if (
    action.startsWith("risk_") ||
    action.includes("rejected") ||
    action.includes("suspend") ||
    action.includes("remove")
  ) {
    return "bg-danger";
  }
  return "bg-warn";
}

export default async function AdminAuditPage() {
  const { data: events } = await createAdminClient()
    .from("audit_events")
    .select("id,actor_type,action,entity_type,entity_id,after_data,metadata,occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(200);

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Audit log"
        sub="Every operator decision, with its reason, permanently recorded."
      />

      {!events?.length ? (
        <EmptyState
          title="No audit events yet"
          body="Payout decisions, risk actions and configuration changes appear here."
        />
      ) : (
        <Panel className="overflow-hidden">
          {events.map((event) => {
            const after = (event.after_data ?? {}) as { reason?: string };
            return (
              <div
                key={event.id}
                className="flex items-start gap-3 border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 flex-none rounded-full ${dotClass(event.action)}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold capitalize text-ink">
                    {event.action.replace(/_/g, " ")}
                    <span className="font-normal text-ink-muted">
                      {" "}
                      · {event.entity_type.replace(/_/g, " ")}
                    </span>
                  </span>
                  {after.reason ? (
                    <span className="block text-[12.5px] text-ink-soft">“{after.reason}”</span>
                  ) : null}
                  <span className="block text-[11.5px] text-ink-muted">
                    {event.actor_type} · {new Date(event.occurred_at).toLocaleString()}
                  </span>
                </span>
              </div>
            );
          })}
        </Panel>
      )}
    </main>
  );
}
