import Link from "next/link";
import { redirect } from "next/navigation";

import { ActionBanner } from "@/components/ui/action-banner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClasses } from "@/components/ui/field";
import { PageHeader, Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { isFeatureEnabled } from "@/lib/flags";
import {
  MAX_REPLY_LENGTH,
  getThread,
  listConversations,
  type ConversationMode,
  type InboxConversation,
  type InboxMessage,
} from "@/lib/whatsapp/inbox";

import { replyAction, setModeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * WhatsApp inbox: every buyer conversation on the shared SnapDuka number that
 * is bound to this shop, the assistant's replies included, with a reply box
 * and take-over / hand-back controls.
 *
 * The reply box only exists while the buyer's 24-hour window is open — outside
 * it WhatsApp accepts approved templates only, and a box that fails on submit
 * would teach sellers the inbox is broken.
 */

const MODE_LABEL: Record<ConversationMode, { label: string; tone: BadgeTone }> = {
  agent: { label: "Assistant", tone: "accent" },
  human: { label: "You", tone: "success" },
  paused: { label: "Paused", tone: "neutral" },
};

const AUTHOR_LABEL: Record<InboxMessage["author"], string> = {
  buyer: "Buyer",
  agent: "Assistant",
  seller: "You",
  system: "SnapDuka",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ConversationRow({ conversation, active }: { conversation: InboxConversation; active: boolean }) {
  const mode = MODE_LABEL[conversation.mode];
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`block border-b border-[#F7F2EA] px-4 py-3 no-underline transition-colors last:border-b-0 hover:bg-paper ${active ? "bg-raised" : ""}`}
      href={`/dashboard/inbox?c=${conversation.id}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[13.5px] font-semibold text-ink">{conversation.buyerPhone}</span>
        <span className="flex-none text-[11px] text-ink-muted">{when(conversation.lastMessageAt)}</span>
      </span>
      <span className="mt-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">{conversation.preview || "—"}</span>
        {conversation.unreadCount > 0 ? (
          <span
            aria-label={`${conversation.unreadCount} unread`}
            className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white"
          >
            {conversation.unreadCount}
          </span>
        ) : null}
        <Badge tone={mode.tone}>{mode.label}</Badge>
      </span>
    </Link>
  );
}

function ModeButton({ conversationId, mode, children }: { conversationId: string; mode: ConversationMode; children: string }) {
  return (
    <form action={setModeAction}>
      <input name="conversationId" type="hidden" value={conversationId} />
      <input name="mode" type="hidden" value={mode} />
      <SubmitButton
        className="min-h-9 cursor-pointer rounded-lg border border-line-strong bg-white px-3 text-[12.5px] font-semibold text-ink transition-colors hover:border-[#B9AC98]"
        pendingLabel="Saving…"
      >
        {children}
      </SubmitButton>
    </form>
  );
}

function Thread({
  conversation,
  messages,
  canReply,
  enabled,
}: {
  conversation: InboxConversation;
  messages: InboxMessage[];
  canReply: boolean;
  enabled: boolean;
}) {
  const mode = MODE_LABEL[conversation.mode];
  return (
    <Panel className="flex min-h-[520px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-raised/60 px-4.5 py-3">
        <div className="min-w-0">
          <Link className="text-[12px] font-semibold text-ink-muted no-underline md:hidden" href="/dashboard/inbox">
            ← All conversations
          </Link>
          <h2 className="truncate text-[14px] font-bold text-ink">{conversation.buyerPhone}</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            Answered by <Badge tone={mode.tone}>{mode.label}</Badge>
            {conversation.mode === "human" && conversation.humanUntil
              ? ` until ${when(conversation.humanUntil)}`
              : null}
          </p>
        </div>
        {canReply ? (
          <div className="flex flex-wrap gap-2">
            {conversation.mode !== "human" ? (
              <ModeButton conversationId={conversation.id} mode="human">Take over</ModeButton>
            ) : null}
            {conversation.mode !== "agent" ? (
              <ModeButton conversationId={conversation.id} mode="agent">Hand back to assistant</ModeButton>
            ) : null}
            {conversation.mode !== "paused" ? (
              <ModeButton conversationId={conversation.id} mode="paused">Pause replies</ModeButton>
            ) : null}
          </div>
        ) : null}
      </div>

      <ol aria-label="Messages" className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4.5 py-4">
        {messages.map((message) => {
          const mine = message.direction === "outbound";
          return (
            <li className={`flex ${mine ? "justify-end" : "justify-start"}`} key={message.id}>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] ${
                  mine ? "bg-[#E7F4EE] text-ink" : "border border-line bg-white text-ink"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.body || `[${message.type}]`}</p>
                <p className="mt-1 text-[10.5px] text-ink-muted">
                  {AUTHOR_LABEL[message.author]} · {when(message.createdAt)}
                  {mine && message.status === "failed" ? " · not delivered" : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-line-soft p-4">
        {!canReply ? (
          <p className="text-[12.5px] text-ink-muted">Your role can read this conversation but not reply.</p>
        ) : !enabled ? (
          <p className="text-[12.5px] text-ink-muted">WhatsApp replies are not available on your shop yet.</p>
        ) : conversation.windowOpen ? (
          <form action={replyAction} className="grid gap-2">
            <input name="conversationId" type="hidden" value={conversation.id} />
            <label className="sr-only" htmlFor="inbox-reply">
              Reply
            </label>
            <textarea
              className={inputClasses(false, "min-h-[76px] resize-y")}
              id="inbox-reply"
              maxLength={MAX_REPLY_LENGTH}
              name="text"
              placeholder="Write a reply. Sending it takes over from the assistant for 12 hours."
              required
              rows={3}
            />
            <div className="flex justify-end">
              <SubmitButton
                className="min-h-10 cursor-pointer rounded-lg bg-ink px-4 text-[13px] font-semibold text-paper"
                pendingLabel="Sending…"
              >
                Send on WhatsApp
              </SubmitButton>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-line bg-raised px-4 py-3 text-[12.5px] text-ink-soft" role="status">
            <p className="font-semibold text-ink">The 24-hour reply window has closed.</p>
            <p className="mt-1">
              WhatsApp only lets businesses send approved templates once a buyer has been quiet for 24 hours. Order
              updates still reach them automatically; to talk freely, wait for the buyer to message again.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; cursor?: string; error?: string; saved?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") redirect("/login?next=/dashboard/inbox");
  const role = actor.role ?? "owner";
  if (!hasPermission(role, "customers.read")) {
    return (
      <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
        <PageHeader title="Inbox" />
        <EmptyState title="Not available for your role" body="Ask the shop owner for access to customer conversations." />
      </main>
    );
  }

  const query = await searchParams;
  const [enabled, page, thread] = await Promise.all([
    isFeatureEnabled("wa_outbound", { sellerAccountId: actor.sellerAccountId }),
    listConversations(actor.sellerAccountId, { cursor: query.cursor }),
    query.c ? getThread(actor.sellerAccountId, query.c) : Promise.resolve(null),
  ]);
  const canReply = hasPermission(role, "orders.manage");

  return (
    <main className="sd-main mx-auto max-w-[1180px] px-4 pt-6 sm:px-6">
      <ActionBanner error={query.error} saved={query.saved} />
      <PageHeader
        title="Inbox"
        sub="WhatsApp conversations with your buyers. The assistant answers until you take over."
      />

      {page.conversations.length === 0 && !thread ? (
        <EmptyState
          title="No conversations yet"
          body="When a buyer messages SnapDuka on WhatsApp with your shop code, the conversation appears here."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <Panel className={`overflow-hidden ${thread ? "hidden md:block" : ""}`}>
            <nav aria-label="Conversations">
              {page.conversations.map((conversation) => (
                <ConversationRow active={conversation.id === query.c} conversation={conversation} key={conversation.id} />
              ))}
            </nav>
            {page.nextCursor ? (
              <Link
                className="block border-t border-line-soft px-4 py-3 text-center text-[12.5px] font-semibold text-ink-soft no-underline"
                href={`/dashboard/inbox?cursor=${encodeURIComponent(page.nextCursor)}`}
              >
                Older conversations
              </Link>
            ) : null}
          </Panel>

          {thread ? (
            <Thread canReply={canReply} conversation={thread.conversation} enabled={enabled} messages={thread.messages} />
          ) : query.c ? (
            <EmptyState title="Conversation not found" body="It may belong to another shop, or the link is out of date." />
          ) : (
            <Panel className="hidden min-h-[520px] place-items-center p-8 text-center text-[13px] text-ink-muted md:grid">
              Choose a conversation to read it.
            </Panel>
          )}
        </div>
      )}
    </main>
  );
}
