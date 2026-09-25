import "server-only";

/**
 * Side-effect imports that register outbox handlers. Each feature module that
 * consumes domain events adds one line here, so the worker loads every handler
 * without the handler modules needing to know about the worker.
 */
import "@/lib/protect/handlers";
import "@/lib/financing/notifications";
import "@/lib/analytics/handlers";
import "@/lib/whatsapp/agent/handler";

export {};
