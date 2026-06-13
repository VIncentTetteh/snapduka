# Notifications

Commerce transitions enqueue notification records. Provider failures do not roll back orders or payments.

The internal processor requires `Authorization: Bearer $INTERNAL_JOB_SECRET`. Jobs are claimed optimistically, retried with exponential backoff, and recorded in `notification_attempts`. Five failed attempts produce a dead-letter outcome for operational review.

Email is transactional when configured. Automated WhatsApp requires valid consent and approved provider/template configuration. Buyer-initiated `wa.me` links remain available independently.

Alert on a rising failed-notification count, stale queued jobs, and repeated provider authorization errors.
