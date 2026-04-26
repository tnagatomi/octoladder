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
- `.github/workflows/ci.yml` (Rails-specific CI; sync workflow will
  replace it)

### POROs relocated and de-Railsified
- `app/models/{period,ranking,github_client,teams_config}.rb`
  → `lib/octoladder/`
- `Period`: top-level `require "active_support/all"` so it stands alone.
- `TeamsConfig`: `Rails.root.join("config/teams.yml")` →
  `File.expand_path("../../config/teams.yml", __dir__)`.
- `GithubClient`: `1.second` → `1` (no ActiveSupport dependency).
- `Ranking`: unchanged (was already plain Ruby).

### Tooling
- `Gemfile`: down to `activesupport`, `octokit`, `rake`, `minitest`,
  `webmock`. No version pins.
- `Gemfile.lock`: regenerated (25 gems).
- `.ruby-version`: `4.0.2` → `4.0.3` (matches the locally installed
  Ruby).
- `test/test_helper.rb`: plain Minitest setup — loads ActiveSupport,
  WebMock (net-disabled), the four POROs, and sets `Time.zone` from
  `OCTOLADDER_TIME_ZONE` (default `Asia/Tokyo`).
- `Rakefile`: minimal `Rake::TestTask` so `bundle exec rake` runs all
  tests.
- All 55 ported tests (105 assertions) pass.

### Naming
- Renamed everywhere from `octladder` to `octoladder` (extra "o" to
  match Octocat). Includes `lib/`, test require paths, the
  `OCTOLADDER_TIME_ZONE` env var, both plan docs, and the comment in
  `config/teams.yml`.
- The local repo directory is still `octladder/`; rename externally
  whenever convenient.

## Current repo layout

```
.
├── .github/dependabot.yml
├── .gitignore
├── .ruby-version
├── Gemfile
├── Gemfile.lock
├── README.md                       # still the Rails default; rewrite pending
├── Rakefile
├── config/
│   └── teams.yml
├── docs/plans/
│   ├── initial-plan.md
│   ├── github-actions-plan.md
│   └── progress.md                 # this file
├── lib/octoladder/
│   ├── github_client.rb
│   ├── period.rb
│   ├── ranking.rb
│   └── teams_config.rb
└── test/
    ├── test_helper.rb
    └── models/
        ├── github_client_test.rb
        ├── period_test.rb
        ├── ranking_test.rb
        └── teams_config_test.rb
```

## Remaining work

Ordered so each step is shippable on its own and unblocks the next.

### 1. Move PORO tests out of `test/models/`
The `models/` subdirectory is a Rails artifact. Flatten to `test/` (or
introduce `test/octoladder/` to mirror `lib/octoladder/`). One commit.

### 2. Runtime config
- `config/octoladder.yml` — `time_zone`, `backfill_anchor` (optional;
  default = Jan 1 of the previous calendar year).
- `lib/octoladder/config.rb` — small loader that reads it and applies
  `Time.zone`.

### 3. State persistence
- `lib/octoladder/state.rb` — load/save `data/state.json`. Schema per
  `github-actions-plan.md` ("Data Model" section). Deterministic
  ordering on save so diffs are reviewable. Treat absent file as empty.
- Tests for round-trip and ordering.

### 4. Sync
- `lib/octoladder/sync.rb` — orchestrates `TeamsConfig` + `GithubClient`
  + `State` per the algorithm in the plan ("Sync Algorithm" section).
  Reconciles users (`active` flag), fetches PRs from
  `(latest merged_at − 1 day)` or `backfill_anchor`, dedupes by
  `github_id`.
- `bin/sync` — entry point: load config, build client from env, run
  sync, write state.
- Tests with WebMock stubs covering: empty state backfill, incremental
  fetch, user join, user leave, team removal.

### 5. Static site rendering
- `views/` — ERB layout + one template per period type. CSS only,
  zero JS. Design reference can be the deleted
  `app/views/rankings/show.html.erb` if needed (recoverable from git
  history).
- `lib/octoladder/site.rb` — enumerate periods within the backfill
  window, compute `Ranking` per period, render to `site/<type>/<param>.html`.
  Generate `site/index.html` redirecting to the latest closed weekly
  period.
- `bin/build` — entry point.
- Tests for period enumeration and at least a smoke test of HTML
  rendering.

### 6. CI / Pages workflow
- `.github/workflows/sync.yml` — schedule (cron, UTC equivalent of the
  configured TZ) + `workflow_dispatch`. Steps: checkout (write),
  setup-ruby, bundle install, `bin/sync`, commit + push state if
  changed, `bin/build`, `actions/upload-pages-artifact`,
  `actions/deploy-pages`. Permissions: `contents: write`,
  `pages: write`, `id-token: write`.
- A separate `.github/workflows/test.yml` for PRs (run `rake test`).

### 7. README
Replace the default Rails README with operator-facing setup instructions
(secret name, enabling private Pages, manual first sync, where to look
when something goes wrong).

### 8. Local repo directory rename
External `mv octladder octoladder` once the user is ready. Not blocking
anything in the repo itself.
