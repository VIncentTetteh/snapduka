-- Sellers can categorise their own products.
--
-- 202607180030 created the `categories` taxonomy and the `product_categories`
-- join, but only operators could write the join (through the service-role
-- client in /admin/products). Nothing on the seller side assigned a category,
-- so the taxonomy was empty of meaning: Snap-to-list suggested a category the
-- form then threw away, and suggest_price(), which prices by category median,
-- had nothing to aggregate.
--
-- Mobile writes straight to PostgREST with the seller's JWT, so RLS is the
-- whole boundary here and no app-layer check can stand in for it. Three rules,
-- each checked against the row the id *points at*, not a tenant column the
-- writer supplies (product_categories has no seller column to trust anyway):
--   * the product belongs to the caller's account — owner via
--     current_seller_account_id(), team member via team_has_role() with the
--     same manager/catalog roles products_team_write allows;
--   * the account is operable — suspended sellers cannot write, and the owner
--     predicate is in WITH CHECK because an INSERT never consults USING;
--   * the category is active — a retired category cannot be newly attached.
-- `assigned_by` must be the caller, so a seller cannot attribute an assignment
-- to an operator.
--
-- There is no UPDATE: the primary key is (product_id, category_id), so a change
-- of category is a delete and an insert, done atomically by
-- set_product_category() below.

-- ── Team read (owner and operator read already exist) ───────────────────────
create policy product_categories_team_read on public.product_categories
for select to authenticated
using (
  exists (
    select 1 from public.products p
     where p.id = product_categories.product_id
       and (select public.team_has_role(p.seller_account_id,
             array['manager','catalog','fulfillment','support','analyst']::public.team_role[]))
  )
);

-- ── Owner writes ────────────────────────────────────────────────────────────
create policy product_categories_owner_insert on public.product_categories
for insert to authenticated
with check (
  assigned_by = (select auth.uid())
  and (select public.current_seller_status()) in ('pending', 'active')
  and exists (
    select 1 from public.products p
     where p.id = product_categories.product_id
       and p.seller_account_id = (select public.current_seller_account_id())
  )
  and exists (
    select 1 from public.categories c
     where c.id = product_categories.category_id and c.active
  )
);

create policy product_categories_owner_delete on public.product_categories
for delete to authenticated
using (
  (select public.current_seller_status()) in ('pending', 'active')
  and exists (
    select 1 from public.products p
     where p.id = product_categories.product_id
       and p.seller_account_id = (select public.current_seller_account_id())
  )
);

-- ── Team writes ─────────────────────────────────────────────────────────────
-- seller_account_operable() rather than current_seller_status(): the latter
-- resolves through seller_accounts.auth_user_id and is NULL for a team member,
-- so it could never express "the account being acted on is suspended".
create policy product_categories_team_insert on public.product_categories
for insert to authenticated
with check (
  assigned_by = (select auth.uid())
  and exists (
    select 1 from public.products p
     where p.id = product_categories.product_id
       and (select public.team_has_role(p.seller_account_id, array['manager','catalog']::public.team_role[]))
       and public.seller_account_operable(p.seller_account_id)
  )
  and exists (
    select 1 from public.categories c
     where c.id = product_categories.category_id and c.active
  )
);

create policy product_categories_team_delete on public.product_categories
for delete to authenticated
using (
  exists (
    select 1 from public.products p
     where p.id = product_categories.product_id
       and (select public.team_has_role(p.seller_account_id, array['manager','catalog']::public.team_role[]))
       and public.seller_account_operable(p.seller_account_id)
  )
);

grant insert, delete on public.product_categories to authenticated;

-- ── One call to set a product's category ────────────────────────────────────
-- SECURITY INVOKER on purpose: every statement runs under the policies above,
-- so this adds atomicity (delete + insert in one transaction, so a failed
-- insert cannot leave the product uncategorised) and nothing else. It cannot
-- widen access.
--
-- The seller UI offers one category per product. Setting it replaces every
-- existing assignment, including one an operator made: the product is the
-- seller's, and an operator who disagrees re-assigns it (and is audited doing
-- so). The web and mobile callers only invoke this when the seller actually
-- changes the value, so an unrelated edit never clobbers an operator's
-- multi-category assignment.
create or replace function public.set_product_category(p_product_id uuid, p_category_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owned boolean;
begin
  -- products_public_read makes any active product visible, so visibility is
  -- not ownership. Ask the same question the write policies ask, and fail
  -- loudly instead of letting a delete on someone else's product match nothing
  -- and report success.
  select exists (
    select 1 from public.products p
     where p.id = p_product_id
       and (
         p.seller_account_id = (select public.current_seller_account_id())
         or (select public.team_has_role(p.seller_account_id, array['manager','catalog']::public.team_role[]))
       )
  ) into v_owned;
  if not v_owned then
    raise exception using errcode = '42501', message = 'That product is not in your catalogue.';
  end if;

  delete from public.product_categories where product_id = p_product_id;

  if p_category_id is not null then
    insert into public.product_categories (product_id, category_id, assigned_by)
    values (p_product_id, p_category_id, (select auth.uid()));
  end if;
end;
$$;

comment on function public.set_product_category(uuid, uuid) is
  'Replaces a product''s categories with one (or none, for null). SECURITY INVOKER: RLS on product_categories is the boundary.';

revoke all on function public.set_product_category(uuid, uuid) from public, anon;
grant execute on function public.set_product_category(uuid, uuid) to authenticated;
