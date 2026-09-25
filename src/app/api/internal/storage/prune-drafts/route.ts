import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { withCronMonitor } from "@/lib/observability/cron";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Deletes abandoned Snap-to-list photos.
 *
 * Mobile uploads the snapped photo to `{seller}/drafts/` before any product
 * exists, so the same upload can become the product's first photo on save. A
 * seller who snaps and walks away leaves it in a public bucket forever.
 *
 * What is deletable is decided in SQL (`draft_media_prune_candidates`,
 * migration 202609250262): product-images only, exactly `{seller}/drafts/{file}`,
 * older than 48 hours, and not referenced by any product_media row. The path
 * shape is re-checked here before anything is removed, so a future change to
 * that function cannot turn this job into one that deletes product photos.
 *
 * Deletion goes through the Storage API: storage.objects refuses direct
 * deletes, and a row deleted in SQL would orphan the stored object anyway.
 *
 * Bounded: at most MAX_BATCHES x BATCH_SIZE objects per run, keyset-paged by
 * name so an object the Storage API refuses to delete is stepped over rather
 * than retried at the head of every page.
 */

// Route files may only export handlers, so these stay module-private.
/** Same bucket as LISTING_DRAFT_BUCKET; not imported to keep the AI client out of this route. */
const BUCKET = "product-images";
const DRAFT_MIN_AGE = "48 hours";
const BATCH_SIZE = 100;
const MAX_BATCHES = 10;

/** `{seller uuid}/drafts/{file}` and nothing else. */
const DRAFT_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/drafts\/[^/]+$/;

function isDraftMediaPath(path: string): boolean {
  return DRAFT_PATH.test(path) && !path.includes("..");
}

async function runJob(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  let cursor: string | null = null;
  let deleted = 0;
  let failed = 0;
  let batches = 0;

  while (batches < MAX_BATCHES) {
    const after: string | undefined = cursor ?? undefined;
    const { data, error } = await admin.rpc("draft_media_prune_candidates", {
      p_min_age: DRAFT_MIN_AGE,
      p_after: after,
      p_limit: BATCH_SIZE,
    });
    if (error) {
      // A job that cannot select is not a quiet no-op: the bucket keeps growing.
      console.error("[prune-drafts] candidate query failed", { code: error.code, message: error.message });
      return NextResponse.json({ error: "Prune failed.", deleted, failed }, { status: 500 });
    }
    const names: string[] = (data ?? []).map((row) => row.name);
    if (names.length === 0) break;
    batches += 1;
    cursor = names[names.length - 1];

    const paths = names.filter(isDraftMediaPath);
    if (paths.length !== names.length) {
      console.error("[prune-drafts] refused non-draft candidates", { count: names.length - paths.length });
    }
    if (paths.length) {
      const { data: removed, error: removeError } = await admin.storage.from(BUCKET).remove(paths);
      if (removeError) {
        failed += paths.length;
        console.error("[prune-drafts] storage remove failed", { count: paths.length, message: removeError.message });
      } else {
        deleted += removed?.length ?? 0;
        failed += paths.length - (removed?.length ?? 0);
      }
    }
    if (names.length < BATCH_SIZE) break;
  }

  return NextResponse.json({ deleted, failed, batches });
}

export const POST = withCronMonitor("snapduka-prune-draft-media", runJob, { schedule: "20 3 * * *" });
export const GET = POST;
