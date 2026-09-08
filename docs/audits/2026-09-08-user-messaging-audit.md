# Messaging and notifications audit — 2026-09-08

## Scope and evidence

Source review and isolated fixtures only. No production messages, uploads, push sends, user-data reads or mutations were performed. Database regressions used a random schema in the explicitly allowlisted loopback `radiohub_test` database; fixture schemas and connections were cleaned up. Retained migration databases were not accessed.

## Corrected defects

- Conversation, contact, unread-count and inbox query caches are account-scoped, including the header and profile sidebar. Account changes reset message drafts and notification preferences.
- Send/upload results retain the initiating recipient. Late completion cannot clear another conversation's draft or send an uploaded image to a newly selected recipient. A synchronous in-flight guard and disabled mutation retries prevent UI duplicate sends; failed/uncertain responses remain visible.
- Conversation cursors resolve only within the authenticated participant pair. Stable timestamp/ID ordering and a lookahead record provide accurate history pagination; earlier messages are reachable in the UI.
- HTTP read receipts update only returned incoming message IDs. An unseen concurrent arrival remains unread, and its notification is not cleared prematurely.
- Unrelated private partner lookups are refused unless a follow relationship or existing conversation establishes access. Presence no longer exposes every connected account. Typing destinations are relationship-checked. New image messages accept only existing local chat-upload URL shapes, not arbitrary tracking URLs.
- Inbox native `read` and string sender-ID fields now match the frontend. Header and inbox share localized message/station/user navigation; the station slug is preferred. Notification times use the selected locale.
- Known notification categories are filtered **before** SQL pagination. Nine known types are explicitly allowlisted; unknown and expired records remain excluded. Existing 10-day social/station, 7-day message and 30-day system retention windows are retained. Counts cover the complete visible category, not just the current page.
- Private API responses are `no-store`. Notification cache invalidation uses a real cache-key prefix, not a literal wildcard that failed in memory. Cache failure does not change a committed read operation into an apparent failed mutation.
- Notification preference HTTP errors roll back the optimistic toggle, concurrent saves are guarded, and loading/errors are not mislabeled as empty inboxes. The missing settings API is handled by the separate profile/account patch.

## Regression verification

- API: **12 passed**, including **4 real PostgreSQL tests**, zero skips (`postgres-messages-routes.test.ts`, `postgres-message-isolation.integration.test.ts`).
- Frontend: **77 passed**: 33 message/notification/target/lifecycle tests plus 44 header keyboard/country tests. The notification target helper is exercised in all 14 primary locales.
- API and frontend TypeScript checks passed after regenerating the shared profile schema declarations. Owned diffs pass whitespace checks.
- Synthetic tests cover account switching, delayed message and image-upload completion, duplicate click/error handling, history cursors, unrelated users, read ownership, expiry, category pagination, and native response fields.

## Explicit limits

This is not proof of real push delivery or a live multi-device conversation. No new user-block product model was introduced: none was found in the audited message schema/routes. Existing chat image files still use unguessable public upload URLs; authenticated private-media serving is a separate architectural change. Active-conversation tracking remains user-level in `ChatService`, so a multi-tab close can affect another tab's notification suppression. General server idempotency keys were not added; the UI does not silently retry uncertain sends. The conversation list's existing 50-item cap and contacts' 100-item cap remain unchanged.

Existing authored notification bodies and all historical interface copy were not bulk-translated or rewritten. Locale-aware navigation and dates are verified; this report does not claim complete 14-language copy coverage or production deployment.
