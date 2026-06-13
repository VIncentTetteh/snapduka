# Incidents

Classify incidents as payment integrity, authorization isolation, data loss, notification degradation, checkout degradation, or provider outage.

Immediate response:

1. Assign an incident owner and request ID.
2. Stop destructive actions; restrict affected payment or seller capabilities when necessary.
3. Preserve signed provider events, audit events, and redacted logs.
4. Reconcile orders, payments, stock reservations, and refunds.
5. Communicate buyer-safe status without exposing internal data.
6. Record timeline, impact, root cause, remediation, and follow-up tests.

Authorization-isolation or payment-integrity incidents are severity one. Rotate affected secrets and review all events in the exposure window.
