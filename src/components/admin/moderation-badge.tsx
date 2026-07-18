import { Badge, type BadgeTone } from "@/components/ui/badge";

const MODERATION_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  hidden: { label: "Hidden", tone: "danger" },
  flagged: { label: "Flagged", tone: "warn" },
};

/** Renders nothing for the default "clear" state — only surfaces operator action. */
export function ModerationBadge({ status }: { status: string }) {
  const spec = MODERATION_STATUS[status];
  if (!spec) return null;
  return <Badge tone={spec.tone}>{spec.label}</Badge>;
}
