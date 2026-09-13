# Internship challenge requirement mapping

Source: the Photo Sharing Platform requirement document supplied for the
September 20, 2026 internship challenge. The example event, totals and PIN in
that document are illustrative; the application supports arbitrary events,
selections and six-digit PINs.

| Requirement | Implementation / verification |
|---|---|
| Lead registration/login | Auth UI, hashed credentials, server sessions; integration test |
| Create events and add members | Event and Team screens, per-event membership; integration test |
| Member assigned events and own photos | API filters and media authorization; member browser test and integration test |
| Members cannot publish or manage others' photos | Role/ownership guards; publish, select, edit, delete rejection tests |
| Multiple uploads to cloud object storage | Four concurrent signed Supabase uploads; metadata in PostgreSQL |
| Failed uploads handled | Object verification before confirmation; individual retry states; integration test |
| Lead views team photos and selects a collection | Team photo list and bulk select/deselect; integration test |
| Create/publish gallery and set PIN | Custom or generated PIN, atomic gallery snapshot, draft/publish/unpublish controls |
| Customer link + PIN without an account | Server-backed gallery session, PIN form, grid/lightbox; browser and integration tests |
| Wrong PIN and unpublished photo protection | Rate limits and gallery authorization for lists, images and downloads; integration test |
| Authentication, authorization, validation, errors | Cookie sessions, CSRF, roles, ownership, Zod and consistent error envelopes |
| Responsive UI | Browser tests at 375, 768, 1280 and 1920 pixels |
| Schema and API | Supabase migration, Drizzle schema, generated OpenAPI/client |
| README and architecture explanation | README with setup, variables, diagram, data model, deployment and limitations |
| Source repository | https://github.com/shivanshu11092003/trizen; push the completed implementation commit before submission |
| Demo lead/member/gallery credentials | README; `pnpm db:seed` creates functional demo data and image objects |
| Public cloud deployment | Frontend and API deployed to https://photos-api.shivanshugupta1109.workers.dev; public browser workflow passed September 13, 2026 |

Optional features implemented include image resizing with fallback, signed
cursor pagination, search/filtering, bulk uploads, downloads, gallery expiry in
the API, and CI/CD. Core workflow tests run against real Supabase services.

The README includes verified live application and customer gallery URLs. The
source repository still needs the completed implementation commit pushed
to match the deployment. Submission email is a separate manual action; this
repository does not send a submission automatically.
