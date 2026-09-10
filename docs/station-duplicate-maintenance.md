# Safe station duplicate maintenance

## Admin workflow

In **Stations → Duplicates**, choose **Preview all candidate groups**. This scans
the entire catalogue, not the currently displayed page or search filters. Review
the eligible count and skipped reasons, then confirm **Merge eligible groups**.
The dedicated Duplicate Management page uses the same workflow.

Names/countries alone identify candidates, not proof of identical broadcasts.
Bulk merges require exact normalized identity, compatible country/city/state,
and a shared actual HTTP(S) stream endpoint. Query strings and protocols remain
significant. Ambiguous/changed/oversized groups stay separate for manual review.
This is an identity check, not a fresh live stream availability test.

## Automatic operation

- PostgreSQL migrations `0030` and `0031` run through normal deployment startup.
- No additional required Railway variable or separate service.
- First automatic run is due 24 hours after the control row is created; daily
  thereafter. At most 100 stricter (shared raw URL) candidate groups per day.
- A persistent cursor rotates through candidates so skipped groups cannot
  permanently block later names.
- One API worker processes at most 10 groups per 15-second cycle across replicas.
  Soft cycle budget: 750 ms; statement timeout: 600 ms; lock wait: 50 ms.
  Busy event loop/pool yields. No stream requests, translation/AI calls or extra
  paid services. This still consumes a small amount of existing database/CPU.
- `DUPLICATE_MERGE_ENABLED=false` disables the worker and new bulk jobs;
  `BACKGROUND_JOBS_ENABLED=false` also disables it. Development is disabled.
- Repeated timeouts defer that group for review; a later daily run can reassess it.

## Preservation and recovery

Jobs, frozen preview member IDs and progress live in PostgreSQL. Closing the page
does not cancel a queued operation. Restarted workers resume committed progress.
Each group's merge and checkpoint commit together, with safe revalidation under
station row locks. A completed preview can only create one apply job.

The survivor retains protected/manual values. Missing translation fields are
filled, while conflicting donor content and full original records are archived
per losing station. Favorite, rating, playback and recommendation references are
transferred; conflicting reviews remain in the archive. Old slugs redirect to
the survivor in the requested language, and saved IDs/UUIDs resolve to it in
public APIs. Administrative update/delete targets are not silently redirected.

Merged provider UUIDs are excluded from reimport; the shared survivor stream URL
is **not** blacklisted. Explicit administrative URL bans retain their scope.
Public detail/list/similarity caches are invalidated after committed merge cycles.

Inspect `/api/admin/auto-merge-status` and `/api/admin/merge-jobs/:jobId` through
an authenticated admin session. These responses and the panel distinguish
completed, skipped and failed work; do not equate a candidate count with a count
of records that can safely be merged.

## Console fix shipped alongside this feature

The API serves packaged public fonts, manifest, favicon and Partytown files with
correct content types; missing files return honest 404s, never the SPA HTML.
Admin HTML omits public-only preload/runtime tags. Production debug logging and
credential-bearing auth diagnostics are removed; real warnings/errors remain.
Expired description jobs stop polling. Dead external logo sources can still
return 404s and fall back to placeholders. Browser-extension `contentscript.js`
warnings are not suppressed by this application.
