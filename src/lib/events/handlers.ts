import "server-only";

import type { Json } from "@snapduka/core";

/**
 * Handlers for outbox events (public.domain_events). Delivery is at-least-once,
 * so every handler must be idempotent: running it twice for the same event must
 * leave the world as running it once did.
 *
 * Handlers register by exact event type. An event with no handler is marked
 * processed — it still exists for audit and replay — rather than retried
 * forever.
 */
export type DomainEvent = {
  id: number;
  aggregate: string;
  aggregate_id: string;
  event_type: string;
  payload: Json;
  attempts: number;
};

export type DomainEventHandler = (event: DomainEvent) => Promise<void>;

const registry = new Map<string, DomainEventHandler[]>();

export function onDomainEvent(eventType: string, handler: DomainEventHandler): void {
  registry.set(eventType, [...(registry.get(eventType) ?? []), handler]);
}

export function handlersFor(eventType: string): DomainEventHandler[] {
  return registry.get(eventType) ?? [];
}

/** Test seam: forget every registration. */
export function resetDomainEventHandlers(): void {
  registry.clear();
}
