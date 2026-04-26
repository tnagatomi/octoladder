# Octoladder — GitHub Actions + Pages MVP Plan

## Context

This plan supersedes `initial-plan.md`. The product goal is unchanged —
visualize and rank merged-PR contributions of members of one or more GitHub
organizations — but the runtime architecture changes:

- **No Rails app, no server, no database.** The application becomes a Ruby
  toolchain that runs inside GitHub Actions and publishes a fully static site
  to GitHub Pages.
- The repository hosting Octoladder is itself the deployment target. Operators
  fork / clone it, configure it, and let Actions do the rest.
- The site is published as a **private GitHub Pages site** (Enterprise plan).
  Visibility is controlled by GitHub repo permissions; there is no
  application-level auth.

The motivation for the switch: dropping the long-running container removes
Kamal, Solid Queue, Puma, SQLite-as-a-server, and the operator burden of
maintaining a Linux host. The cost is that the site is fully pre-rendered and
state lives in the repo, not in a database.

## MVP Scope

**In:**
- User registration driven by **GitHub Team sync** across one or more orgs
  (multiple teams). No individual-user add path.
- Backfill of merged public PRs on first sync, reaching back to **Jan 1 of the
  previous calendar year** (in the configured TZ), so the most recent closed
  week, month, and year are all fully populated on day 1.
- A scheduled GitHub Actions workflow that syncs team memberships, fetches
  newly merged PRs, regenerates the static site, and publishes it.
- Individual ranking views for **completed** weekly / monthly / yearly periods,
  with a period navigator (prev / next) over the backfill window.
- Configurable time zone (default `Asia/Tokyo`); all period boundaries and the
  cron schedule honor it.
- No authentication on the site itself; access control is delegated to GitHub
  Pages' private-site mechanism (Enterprise).
- Distribution via a single GitHub repository that the operator owns.

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
   exclusion list. (Unchanged from initial plan.)
2. **Team role:** a team is only a bulk-import source; ranking is always
   individual. Operators maintain membership on GitHub itself.
3. **Departed members:** their already-ingested PRs remain in historical
   rankings; new PRs are simply no longer fetched once they fall out of all
   tracked teams.
4. **Closed-period philosophy:** weekly / monthly / yearly views always mean
   the most recent completed period. Sync cadence is weekly because closed
   periods do not change after they close.
5. **Tie handling:** competitive rank (1, 1, 3, ...). Users with 0 PRs in the
   period are not shown.
6. **Stack:** Ruby (no Rails). ActiveSupport for time-zone math, Octokit for
   GitHub API, ERB for HTML generation. No web framework, no database server.
7. **Persistence:** `data/state.json` committed to the repo by the sync job.
   Holds the canonical list of tracked users, team memberships, and ingested
   merged PRs. Human-readable, diffable, and trivially restorable from git
   history.
8. **Site generation:** every period within the backfill window is
   pre-rendered as a static HTML file. Navigation is plain `<a href>`, so the
   site has zero runtime JS requirements.
9. **GitHub API auth:** a single classic Personal Access Token with `read:org`
   scope, stored as a repo secret named `OCTOLADDER_GITHUB_TOKEN`. The default
   `GITHUB_TOKEN` cannot read team membership across orgs, so a PAT is
   required.
10. **Publication:** GitHub Pages, source = GitHub Actions artifact, visibility
    = private (Enterprise). Access is governed by repo read permission.

## Repository Layout

```
.
├── .github/workflows/
│   ├── sync.yml            # Scheduled + manual sync + build + deploy
│   └── ci.yml              # Test + lint on PRs
├── bin/
│   ├── sync                # Entry point: refresh state.json
│   └── build               # Entry point: render site/ from state.json
├── lib/octoladder/
│   ├── period.rb           # ported from app/models/period.rb
│   ├── ranking.rb          # ported from app/models/ranking.rb
│   ├── github_client.rb    # ported from app/models/github_client.rb
│   ├── teams_config.rb     # ported from app/models/teams_config.rb
│   ├── state.rb            # load / save data/state.json
│   ├── sync.rb             # team + PR reconciliation
│   └── site.rb             # static-site generator
├── views/                  # ERB templates for the site
├── config/
│   ├── teams.yml           # tracked teams (unchanged from initial plan)
│   └── octoladder.yml       # TIME_ZONE, backfill anchor, etc.
├── data/
│   └── state.json          # canonical persisted state
├── site/                   # generated; gitignored
├── test/
└── docs/plans/
    ├── initial-plan.md
    └── github-actions-plan.md
```

The existing Rails skeleton (`app/`, `config/application.rb`, `Gemfile` with
Rails, `db/`, `Dockerfile`, `.kamal/`, `bin/rails`, etc.) is removed during the
migration. Rails-specific test helpers are replaced with plain Minitest.

## Configuration Surface

- `OCTOLADDER_GITHUB_TOKEN` — repo secret; classic PAT with `read:org` scope.
- `config/teams.yml` — declarative list of tracked teams (`org`, `team_slug`).
  Source of truth for membership; reconciled on each sync (additions and
  removals applied).
- `config/octoladder.yml` — non-secret runtime config:
  - `time_zone` (IANA name; default `Asia/Tokyo`)
  - `backfill_anchor` (default: Jan 1 of the previous calendar year, computed
    relative to the first sync date in the configured TZ)
- `.github/workflows/sync.yml` — cron expression for the scheduled run
  (default Monday 02:00 in the configured TZ; encoded as the equivalent UTC
  cron because Actions cron is UTC-only).

## Data Model (`data/state.json`)

```json
{
  "schema_version": 1,
  "synced_at": "2026-04-27T17:00:00Z",
  "backfill_anchor": "2025-01-01",
  "teams": [
    { "org": "rails", "slug": "core", "name": "Core Team" }
  ],
  "users": [
    {
      "github_id": 1234,
      "login": "dhh",
      "name": "David Heinemeier Hansson",
      "avatar_url": "https://...",
      "team_keys": ["rails/core"],
      "active": true
    }
  ],
  "pull_requests": [
    {
      "github_id": 567890,
      "author_login": "dhh",
      "merged_at": "2026-04-20T09:12:00Z",
      "html_url": "https://github.com/rails/rails/pull/12345",
      "repo_full_name": "rails/rails"
    }
  ]
}
```

Notes:
- `users.active = false` marks a user no longer in any tracked team. Their
  past PRs stay; future fetches skip them.
- PRs are deduplicated by `github_id`.
- The file is sorted deterministically (users by `github_id`, PRs by
  `merged_at` then `github_id`) so diffs are minimal and reviewable.

## Sync Algorithm (`bin/sync`)

1. Load `config/teams.yml` and `data/state.json` (treat absent state as empty).
2. For each team in the config: fetch members via Octokit.
3. Reconcile users:
   - New logins → add with `active: true`.
   - Logins still in any team → ensure `active: true`, refresh team links.
   - Logins no longer in any team → set `active: false`, drop team links.
4. For each `active` user:
   - Determine fetch range:
     - If user has no recorded PRs and state is empty → from
       `backfill_anchor` to "now" (in TZ).
     - Else → from `(latest recorded merged_at for that user) - 1 day` to
       "now", to absorb any merges that completed mid-week.
   - Call `GithubClient#merged_prs`.
   - Merge results into `state.pull_requests`, deduping by `github_id`.
5. Update `synced_at`, write `data/state.json`.
6. Commit and push if anything changed (commit author = `github-actions[bot]`).

## Build Algorithm (`bin/build`)

1. Load `data/state.json`.
2. Determine the period set to render:
   - Anchor = `backfill_anchor` (or earliest `merged_at`, whichever is later).
   - End = the latest closed period of each type relative to "now" in TZ.
   - Enumerate every weekly / monthly / yearly period in `[anchor, end]`.
3. For each period, compute a `Ranking` and render `site/<type>/<param>.html`.
4. Render `site/index.html` redirecting to the latest closed weekly period.
5. Render a small `site/assets/` (CSS only; no JS required).
6. Period navigation links are generated at build time; periods outside the
   enumerated set are not linked.

## Workflow (`.github/workflows/sync.yml`)

Triggers:
- `schedule:` weekly cron (UTC equivalent of the configured TZ).
- `workflow_dispatch:` for the initial backfill and ad-hoc runs.

Steps:
1. Check out the repo (with write permission).
2. Set up Ruby (matching `.ruby-version`).
3. `bundle install` (cached).
4. `bin/sync` — uses `OCTOLADDER_GITHUB_TOKEN`.
5. Commit and push `data/state.json` if changed.
6. `bin/build` — produces `site/`.
7. `actions/upload-pages-artifact` + `actions/deploy-pages` — publishes
   `site/` to Pages.

Permissions: `contents: write` (to commit state), `pages: write`,
`id-token: write` (for the Pages deploy action).

## Operator Workflows

**Initial setup:**
1. Create the repo from this template (or fork).
2. Add `OCTOLADDER_GITHUB_TOKEN` to repo secrets.
3. Edit `config/teams.yml`.
4. Enable Pages → source: GitHub Actions, visibility: Private.
5. Trigger `sync.yml` manually for the initial backfill.
6. Subsequent runs are automatic on the cron.

**Add / remove a team:** edit `config/teams.yml`, commit, push. The next sync
applies it. Manual `workflow_dispatch` is available if the operator wants
immediate effect.

**Member turnover:** handled on GitHub. Octoladder reflects it on the next
sync. Past PRs of departed members stay in historical rankings.

**Recovering from a bad sync:** revert the offending commit on
`data/state.json` and re-run the workflow. Because state is in git, recovery
is `git revert`.

## Acceptance Criteria

The MVP is done when all of the following hold on a fresh repo configured
against one or more real GitHub teams:

1. **Setup** completes with only: setting `OCTOLADDER_GITHUB_TOKEN`, editing
   `config/teams.yml`, enabling Pages with private visibility, and running one
   manual sync. No additional manual steps.
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
   backfill window; newer-than-latest-closed periods are not linked.
7. **Ties** share the same rank, and the next rank skips accordingly
   (competitive rank).
8. **Zero-PR users** are absent from the period's ranking.
9. **Backfill** on first sync reaches back to Jan 1 of the previous calendar
   year (in the configured TZ), so every one of the above views is fully
   populated from day 1.
10. **Scheduled sync** runs automatically on the configured cron; newly merged
    PRs from the previous week appear in the published site after the run,
    without manual intervention.
11. **Team churn on GitHub** (adds / removes) is reflected on the next sync:
    new members appear as tracked users; removed members stop receiving new PR
    fetches but their past PRs remain in historical rankings.
12. **Removing a team from `config/teams.yml`** and running the next sync
    stops further fetching for users reachable only through that team,
    without deleting any existing PR records from historical rankings.
13. **Deployment** is fully managed by GitHub: a private Pages site published
    by Actions, with no separately operated server, container, worker, or
    database.

## Migration from the Rails Skeleton

The current repo is a Rails 8 skeleton with the core POROs (`Period`,
`Ranking`, `GithubClient`, `TeamsConfig`) already implemented. Migration steps:

1. Move the four POROs to `lib/octoladder/`, dropping `Rails.root` references
   (use `__dir__`-relative paths) and replacing `Time.zone` / `Time.current`
   with explicit `ActiveSupport::TimeZone` lookups based on
   `config/octoladder.yml`.
2. Port the existing model tests to plain Minitest under `test/`.
3. Implement `lib/octoladder/state.rb`, `sync.rb`, `site.rb`, `bin/sync`,
   `bin/build`.
4. Author `views/` ERB templates (one per period type plus a layout). The
   existing `app/views/` HTML can be used as a starting design reference but
   is not directly reused.
5. Author `.github/workflows/sync.yml`.
6. Delete the Rails skeleton: `app/`, `config/application.rb`,
   `config/environments/`, `config/initializers/`, `config/routes.rb`,
   `config/database.yml`, `config/cache.yml`, `config/queue.yml`,
   `config/recurring.yml`, `config/puma.rb`, `config/deploy.yml`, `db/`,
   `bin/rails`, `bin/setup`, `bin/dev`, `Dockerfile`, `.kamal/`,
   `Procfile.dev`, `Rakefile`, `config.ru`, Rails-only gems from `Gemfile`.
7. Update `README.md` with the new operator workflow.
