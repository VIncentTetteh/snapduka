-- supabase/migrations/202609040078_product_reviews_anon_grant.sql
--
-- Let the storefront actually read reviews.
--
-- 202609040075 created `product_reviews_public_read` for anon and authenticated
-- but never granted the privilege. An RLS policy restricts access; it does not
-- confer it. So the storefront — which reads with the publishable (anon) key —
-- got "permission denied for table product_reviews", getProductReviews threw,
-- and every product page returned 500 the moment the code shipped.
--
-- `product_review_stats` is SECURITY INVOKER, so the grant on the view alone was
-- never enough either: it reads the base table as the caller. Granting the view
-- and forgetting the table is exactly the shape of this bug.
--
-- The public policy still decides *which* rows anon sees — published reviews on
-- published shops — so this widens privilege, not visibility.

grant select on public.product_reviews to anon, authenticated;
