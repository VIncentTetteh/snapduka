# Backup And Restore

Enable managed PostgreSQL backups and point-in-time recovery in production. Retain storage objects according to the privacy and support-evidence policy.

Quarterly restore drill:

1. Restore the latest backup into an isolated staging project.
2. Apply no production credentials.
3. Verify counts for sellers, shops, products, orders, order lines, payment attempts, and events.
4. Verify every order line references an order and every payment attempt references an order.
5. Run `pnpm db:test` against the isolated database.
6. Record date, backup timestamp, duration, row-count checks, and operator.

No production restoration has been performed by this local implementation session; the first staging drill is a launch-owner responsibility because it requires managed-project access.
