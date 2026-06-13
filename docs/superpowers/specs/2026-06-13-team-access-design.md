# SnapDuka Seller Teams Design

## Scope

Allow eligible sellers to invite team members and assign constrained roles
without weakening seller isolation or operator controls.

## Architecture

`seller_team_members` maps auth users to seller accounts. Membership roles are
`owner`, `manager`, `catalog`, `fulfillment`, `support`, and `analyst`.
Permissions are explicit capabilities resolved by the server and mirrored in
RLS helper functions. The original seller is the immutable owner until a
separate audited ownership-transfer operation completes.

## Behavior

Owners invite by email using expiring, single-use tokens. Invitees may accept
only while authenticated with the invited email. Owners and managers can manage
members, but only owners can manage billing, domains, API credentials, or other
owners. Plan entitlements cap active seats.

Catalog members manage products and inventory. Fulfillment members manage
orders and delivery. Support members handle customer cases. Analysts have
read-only analytics and export access. Managers receive all operational
permissions except owner-only capabilities.

Every membership, invitation, role, and removal mutation creates an audit
event. Removing a member revokes access immediately without deleting actor
history.

## Failure Handling

Expired, reused, wrong-email, and over-seat-limit invitations fail safely.
Permission checks occur server-side for pages, actions, APIs, and database
policies. The UI hiding an action is never considered authorization.

## Acceptance

Tests prove role matrices, invite lifecycle, seat limits, immediate revocation,
owner protection, cross-seller isolation, API authorization, and preservation
of historical actor identity.
