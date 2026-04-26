# Octoladder — MVP Plan

## Context

Octoladder is a self-hosted full-stack Rails application that visualizes and ranks
the OSS contributions (= merged PRs against public repositories) of members of
one or more GitHub organizations. The use case is making internal OSS
participation visible inside a company. The distribution model is inspired by
37signals' ONCE: a single, self-contained app that a company can deploy on its
own infrastructure with minimal external dependencies.

This plan captures the acceptance criteria and the high-level product /
operational choices for the MVP. Implementation design (schema, class layout,
method names, etc.) is intentionally left open and to be decided at coding time,
following the Rails Way.

## MVP Scope

**In:**
- User registration driven by **GitHub Team sync** across one or more orgs
  (multiple teams). No individual-user add path.
- Backfill of merged public PRs on first sync, reaching back to **Jan 1 of the
  previous calendar year** (in the configured TZ), so the most recent closed
  week, month, and year are all fully populated on day 1.
- A weekly background job that syncs team memberships and incrementally fetches
  newly merged PRs.
- Individual ranking views for **completed** weekly / monthly / yearly periods,
  with a period navigator (prev / next).
- Configurable time zone (default `Asia/Tokyo`); all period boundaries and the
  cron schedule honor it.
- No authentication on the Octoladder app itself; deployment on a trusted network
  (VPN / internal) is assumed.
- Deployment via **Kamal**.

**Out (deferred to later versions):**
- Individual user add (outside a team).
- Team-vs-team ranking or team-based filtering.
- Rolling windows (e.g. "last 365 days").
- Per-repository / per-language breakdowns.
- Admin UI for team or user CRUD.
- GitHub App authentication.

## Key Decisions

1. **Contribution definition:** every merged PR authored by a tracked user in
   any **public** repository counts, including PRs to the user's own org. No
   exclusion list.
2. **Team role:** a team is only a bulk-import source; ranking is always
   individual. Operators maintain membership on GitHub itself.
3. **Departed members:** their already-ingested PRs remain in historical
   rankings; new PRs are simply no longer fetched once they fall out of all
   tracked teams.
4. **Closed-period philosophy:** weekly / monthly / yearly views always mean
   the most recent completed period (previous week / month / calendar year).
   Weekly sync cadence is sufficient because closed periods do not change after
   they close.
5. **Tie handling:** competitive rank (1, 1, 3, ...). Users with 0 PRs in the
   period are not shown.
6. **Stack:** Rails 8 + SQLite + Solid Queue + Solid Cache + Propshaft + Hotwire.
   No Redis, no Postgres. Rails Way conventions — no `app/services/` layer;
   domain behavior lives on models / POROs.
7. **GitHub API auth:** a single classic Personal Access Token with `read:org`
   scope supplied via `GITHUB_TOKEN`.
8. **Deployment:** Kamal to any Linux host. Solid Queue runs in-process with
   Puma (`SOLID_QUEUE_IN_PUMA=1`) so the entire app is one container.

## Configuration Surface

- `GITHUB_TOKEN` — classic PAT with `read:org` scope.
- `TIME_ZONE` — IANA name; default `Asia/Tokyo`.
- `CRON_SCHEDULE` — cron expression for the weekly sync; default Monday 02:00
  local.
- `config/teams.yml` — declarative list of tracked teams (`org`, `team_slug`).
  Source of truth for team membership; edited by the operator, committed to the
  repo, reconciled with the DB on each sync (additions **and** removals are
  applied). `db/seeds.rb` is not used for this.

## Operator Workflows

**Initial setup:** populate `.env` + Kamal secrets, list teams in
`config/teams.yml`, `kamal setup` → `kamal deploy`, then trigger the initial
(1-year backfill) sync once. Weekly sync takes over on its own afterwards.

**Add / remove a team:** edit `config/teams.yml` and redeploy (or just wait for
the next sync). Additions and removals are both applied; no manual DB work.

**Member turnover:** handled on GitHub (joining / leaving a team). Octoladder
reflects it on the next sync. Past PRs of departed members stay in historical
rankings.

## Acceptance Criteria

The MVP is done when all of the following hold on a fresh deploy configured
against one or more real GitHub teams:

1. **Setup** completes with only: editing `config/teams.yml`, setting the
   required ENV vars, running `kamal setup` + `kamal deploy`, and triggering one
   initial sync. No additional manual steps.
2. **Tracked-user population** equals the union of current members across the
   teams listed in `config/teams.yml`, observed on any page that lists users.
3. **Weekly ranking** for the previous completed week shows the expected users
   with merged-PR counts matching what GitHub's own search (`is:merged
   author:LOGIN merged:RANGE`) returns for each user within that week, using
   the configured TZ's Monday-through-Sunday boundary.
4. **Monthly ranking** for the previous completed calendar month behaves the
   same way, using calendar-month boundaries in the configured TZ.
5. **Yearly ranking** for the previous completed calendar year behaves the
   same way, using calendar-year boundaries in the configured TZ.
6. **Period navigator** lets the viewer step to older periods within the
   backfill window; newer-than-latest-closed periods are not selectable.
7. **Ties** share the same rank, and the next rank skips accordingly
   (competitive rank).
8. **Zero-PR users** are absent from the period's ranking.
9. **Backfill** on first sync reaches back to Jan 1 of the previous calendar
   year (in the configured TZ), so every one of the above views is fully
   populated from day 1.
10. **Weekly sync** runs automatically on the configured cron; newly merged PRs
    from the previous week appear in the ranking after the run, without manual
    intervention.
11. **Team churn on GitHub** (adds / removes) is reflected on the next sync:
    new members appear as tracked users; removed members stop receiving new PR
    fetches but their past PRs remain in historical rankings.
12. **Removing a team from `config/teams.yml`** and running the next sync stops
    further fetching for users reachable only through that team, without
    deleting any existing PR records from historical rankings.
13. **Deployment** is a single Kamal-managed container; no separate worker
    process, no Redis, no external database.
