# Octoladder — Progress & Remaining Work

Companion to `github-actions-plan.md`. Tracks what has been migrated from
the original Rails skeleton and what is still ahead, so a fresh session
(or a fresh contributor) can pick up without re-reading the full git log.

## Done

### Planning
- `docs/plans/initial-plan.md` — original Rails MVP plan (kept for history).
- `docs/plans/github-actions-plan.md` — current architecture: GitHub
  Actions + private GitHub Pages, Ruby toolchain, JSON-on-disk state.

### Rails skeleton removed
Dropped from the repo:
- `app/`, `db/`, `public/`, `storage/`, `log/`, `tmp/`, `vendor/`,
  `script/`, `lib/tasks/`
- `bin/` (rails / rake / kamal / brakeman / etc.)
- `config/` except `config/teams.yml` (application.rb, boot.rb,
  environment.rb, database.yml, cache.yml, queue.yml, recurring.yml,
  puma.rb, deploy.yml, routes.rb, environments/, initializers/,
  locales/, importmap.rb, credentials.yml.enc, master.key, etc.)
- `Dockerfile`, `.dockerignore`, `.kamal/`, `Procfile.dev`, `Rakefile`
  (re-added later, smaller), `config.ru`, `.gitattributes`, `.env.example`,
  `.rubocop.yml`
- `.github/workflows/ci.yml` (Rails-specific CI; sync workflow replaces
  it)

### POROs relocated and de-Railsified
- `app/models/{period,ranking,github_client,teams_config}.rb`
  → `lib/octoladder/`
- `Period`: top-level `require "active_support/all"` so it stands alone.
- `TeamsConfig`: `Rails.root.join("config/teams.yml")` →
  `File.expand_path("../../config/teams.yml", __dir__)`.
- `GithubClient`: `1.second` → `1` (no ActiveSupport dependency).
- `Ranking`: unchanged (was already plain Ruby).

### Tests
- Relocated from `test/models/` to `test/octoladder/` to mirror
  `lib/octoladder/`.
- New: `config_test.rb`, `state_test.rb`, `sync_test.rb`, `site_test.rb`.

### Runtime config (`OctoladderConfig`)
- `config/octoladder.yml` exposes only `time_zone` (default
  `Asia/Tokyo`). `backfill_anchor` is intentionally not configurable —
  hard-coded at "Jan 1 of the previous calendar year in TZ" to avoid
  footguns (a multi-year anchor would exhaust GitHub search's 1000-PR
  cap and rate limits).

### State persistence (`State`)
- `lib/octoladder/state.rb` — load/save `data/state.json` per the data
  model in the plan. Deterministic ordering (teams by org+slug, users
  by github_id, PRs by merged_at+github_id). Absent files load as
  empty state. Schema-version mismatches raise.

### Sync (`Sync` + `bin/sync`)
- `lib/octoladder/sync.rb` reconciles team membership, deactivates
  departed users while preserving historical PRs, and fetches new
  merged PRs per active user. Fetch window starts one day before each
  user's latest recorded `merged_at` to absorb mid-window merges; falls
  back to the backfill anchor on first sync. PRs deduplicated by
  github_id.
- `bin/sync` wires `OctoladderConfig.load.apply!` +
  `TeamsConfig.load` + `State.load` + `GithubClient.from_env`.

### Site (`Site` + `bin/build`)
- `lib/octoladder/site.rb` enumerates every weekly/monthly/yearly
  period in `[backfill_anchor, latest closed]` and renders each to
  `site/<type>/<param>.html`. PR `merged_at` strings parsed once at
  construction (not per period) and ERB templates compiled-and-cached
  to keep a 70-period build linear in PR count.
- `views/{layout,period}.html.erb` + `views/assets/style.css`. Period
  prev/next links walk only the enumerated set (acceptance criterion
  #6).
- `bin/build` wires `OctoladderConfig.load.apply!` + `State.load` +
  `Site#call`.

### CI / Pages workflows
- `.github/workflows/sync.yml` — schedule (`0 17 * * 0` = Mon 02:00
  JST) + `workflow_dispatch`. Steps: checkout, setup-ruby, sync,
  commit refreshed state, configure-pages, build, upload artifact,
  deploy. Permissions: `contents: write`, `pages: write`,
  `id-token: write`. Concurrency group `pages` (no cancel).
- `.github/workflows/test.yml` — PR + push-to-main test runner.
- All third-party actions pinned to commit SHA with the tag name in
  a trailing comment.

### README
- Operator-facing setup guide (PAT, secret name, teams.yml,
  enabling private Pages, manual first sync), upstream sync
  instructions, local development commands, troubleshooting.

### Naming
- Renamed everywhere from `octladder` to `octoladder`.

## Current repo layout

```
.
├── .github/
│   ├── dependabot.yml
│   └── workflows/
│       ├── sync.yml
│       └── test.yml
├── .gitignore
├── .ruby-version
├── Gemfile
├── Gemfile.lock
├── README.md
├── Rakefile
├── bin/
│   ├── build
│   └── sync
├── config/
│   ├── octoladder.yml
│   └── teams.yml
├── docs/plans/
│   ├── initial-plan.md
│   ├── github-actions-plan.md
│   └── progress.md                 # this file
├── lib/octoladder/
│   ├── config.rb
│   ├── github_client.rb
│   ├── period.rb
│   ├── ranking.rb
│   ├── site.rb
│   ├── state.rb
│   ├── sync.rb
│   └── teams_config.rb
├── test/
│   ├── test_helper.rb
│   └── octoladder/
│       ├── config_test.rb
│       ├── github_client_test.rb
│       ├── period_test.rb
│       ├── ranking_test.rb
│       ├── site_test.rb
│       ├── state_test.rb
│       ├── sync_test.rb
│       └── teams_config_test.rb
└── views/
    ├── assets/style.css
    ├── layout.html.erb
    └── period.html.erb
```

## Remaining work

The MVP code is complete and all unit tests are green (90 runs, 186
assertions). What's left is real-world validation, not code:

1. **End-to-end run on a real repo.** Configure
   `OCTOLADDER_GITHUB_TOKEN`, edit `config/teams.yml` for one or more
   real teams, enable private Pages, trigger the workflow, and verify
   the published site against the acceptance criteria in
   `github-actions-plan.md` (especially the "Weekly / Monthly / Yearly
   ranking … matches what GitHub's own search returns" criteria).
2. **Local repo directory rename.** External `mv octladder octoladder`.
   Not blocking anything in-repo.
