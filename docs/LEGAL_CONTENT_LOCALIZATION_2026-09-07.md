# Legal page localization

The existing website privacy and terms copy is translated into the fourteen
active sitemap languages: en, es, fr, de, pt, it, ru, ar, zh, tr, ja, ko, hi, he.
Every original section and list item is retained. Page colors, typography,
containers and section spacing are retained. Arabic and Hebrew body text has
explicit RTL direction; email addresses retain their natural direction.

This is a translation of existing copy, not a statement of legal compliance or
a newly drafted policy. No mobile-only subscription prices, cancellation rules
or data-erasure promises were copied into the website terms.

## Source and factual corrections

- The former `Last updated: new Date()` displayed the visitor's current date,
  not a document revision. It was removed. `LEGAL_REVIEWED_AT` remains null until
  the owner supplies the actual effective/reviewed date of this website copy.
  The archived July 2025 pages and March 2026 mobile policy differ from the
  website, so neither date establishes this website version's effective date.
- The literal address `123 Radio Street, Music City, MC 12345` was removed.
  The Vienna address in Organization schema is not sufficient independent
  evidence that it is the legal operator/controller's registered address.
- Email domains were aligned with the already published mobile page source,
  `artifacts/api-server/src/routes/mobile-tv-routes.ts`: privacy@themegaradio.com
  and legal@themegaradio.com. This confirms existing published contact copy,
  not delivery or mailbox ownership; no messages were sent.

## Owner verification still required

Confirm the legal operator/controller identity and registered address, valid
contact mailboxes, jurisdiction and actual effective date. The original clauses
about data sharing, rights, liability, account limits, immediate termination
and 30-day terms notice remain unchanged in substance; their applicability and
accuracy still need owner/legal review. The translations have not been certified
by jurisdiction-specific legal reviewers. Any approved substantive revision
must be propagated consistently to all locales and the separate mobile API.

The API renderer and React pages now share the same complete text; raw HTML and
the hydrated page have identical clauses in all fourteen languages. On the
frontend, data is bundled only with the lazily loaded legal page components. No database,
MongoDB, GSC, historical log, account setting, or production deployment changed.
