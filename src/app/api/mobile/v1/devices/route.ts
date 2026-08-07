import { z } from "zod";

import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { failUnexpected, ok } from "@/lib/mobile/response";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Register and deregister a device for push notifications.
 *
 * `device_push_tokens` is service-role write only by design: an open insert
 * policy is exactly how push_subscriptions was once abused
 * (202607210041_push_subscriptions_service_role_only.sql) — anyone could attach
 * their own device to another seller's account and watch their orders. Here the
 * seller_account_id comes from the verified actor, never from the request body.
 */

/** Expo's token format. Anything else cannot be delivered, so reject it early. */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

const registerSchema = z.object({
  expoPushToken: z.string().trim().regex(EXPO_TOKEN, "That is not an Expo push token."),
  platform: z.enum(["ios", "android"]),
  deviceId: z.string().trim().max(200).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

const deregisterSchema = z.object({
  expoPushToken: z.string().trim().regex(EXPO_TOKEN, "That is not an Expo push token."),
});

export async function POST(request: Request) {
  // Any signed-in seller may register their own device; this is not an
  // orders/products capability, so no team permission beyond being a seller.
  const actor = await requireSeller("customers.read");
  if (isResponse(actor)) return actor;

  const limited = await enforceRateLimit("devices.register", actor.sellerAccountId, {
    limit: 20,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, registerSchema);
  if (isResponse(body)) return body;

  try {
    const admin = createAdminClient();
    // Upsert on the token: reinstalling the app, or handing the phone to a
    // different team member, must move the token rather than fail on the unique
    // constraint or leave it pointing at the previous account.
    const { error } = await admin.from("device_push_tokens").upsert(
      {
        seller_account_id: actor.sellerAccountId,
        auth_user_id: actor.userId,
        expo_push_token: body.expoPushToken,
        platform: body.platform,
        device_id: body.deviceId ?? null,
        app_version: body.appVersion ?? null,
        active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "expo_push_token" },
    );
    if (error) return failUnexpected("devices.register", error);

    return ok({ registered: true }, 201);
  } catch (error) {
    return failUnexpected("devices.register", error);
  }
}

export async function DELETE(request: Request) {
  const actor = await requireSeller("customers.read");
  if (isResponse(actor)) return actor;

  const body = await parseBody(request, deregisterSchema);
  if (isResponse(body)) return body;

  try {
    const admin = createAdminClient();
    // Deactivated rather than deleted: the worker marks tokens inactive on a
    // DeviceNotRegistered ticket too, and keeping the row means a reinstall
    // reuses it instead of accumulating orphans.
    const { error } = await admin
      .from("device_push_tokens")
      .update({ active: false })
      .eq("expo_push_token", body.expoPushToken)
      .eq("seller_account_id", actor.sellerAccountId);
    if (error) return failUnexpected("devices.deregister", error);

    return ok({ deregistered: true });
  } catch (error) {
    return failUnexpected("devices.deregister", error);
  }
}
