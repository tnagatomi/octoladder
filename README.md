# Octoladder

Visualize and rank merged-PR contributions of members of one or more GitHub
organizations. Runs entirely as a GitHub Actions workflow that publishes to
private GitHub Pages — no server, no database.

## How it works

A weekly workflow (`Sunday 17:00 UTC` / `Monday 02:00 JST`) syncs team
membership and newly merged PRs across the orgs you configure, commits the
result to `data/state.json`, regenerates static HTML for every weekly,
monthly, and yearly period in the backfill window, and deploys the result
to GitHub Pages. Period boundaries (Mon–Sun weekly, calendar months,
calendar years) honor the configured time zone.

## One-time setup

This repository is a [template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template).
Click **Use this template** to create a copy in your own org, then:

1. **Add a Personal Access Token.** A classic PAT with `read:org` scope is
   required because the default `GITHUB_TOKEN` cannot read team membership
   across orgs. Create one at
   [github.com/settings/tokens](https://github.com/settings/tokens), then
   add it as a repository secret named **`OCTOLADDER_GITHUB_TOKEN`**
   (Settings → Secrets and variables → Actions → New repository secret).
2. **Edit `config/teams.yml`** to list the GitHub teams whose members you
   want to track. Format:
   ```yaml
   - org: your-org
     team_slug: engineering
   - org: another-org
     team_slug: platform
   ```
3. **(Optional) Edit `config/octoladder.yml`** to change the time zone
   from the default `Asia/Tokyo`. If you change it, also update the cron
   expression in `.github/workflows/sync.yml` so the workflow fires on
   Monday morning in your TZ (Actions cron is UTC-only).
4. **Enable GitHub Pages.** Settings → Pages → Build and deployment:
   - Source: **GitHub Actions**
   - Visibility: **Private** (Enterprise required for private Pages;
     access is governed by repo read permission)
5. **Trigger the first sync.** Actions → "Sync and publish" → **Run
   workflow**. The first run backfills from January 1 of the previous
   calendar year, so weekly/monthly/yearly views are all populated on
   day one. After that, the schedule takes over.

## Operating

**Add or remove a team.** Edit `config/teams.yml`, commit, push. The next
scheduled sync picks it up. Or trigger "Sync and publish" manually from
the Actions tab for immediate effect.

**Member turnover.** Handled on GitHub. The next sync reflects it: new
members start being tracked, removed members are marked inactive. Their
historical PRs stay in past rankings; only future PR fetching stops.

**Recovering from a bad sync.** Revert the offending commit on
`data/state.json` and re-run the workflow. State lives in git, so
recovery is `git revert`.

## Pulling in upstream updates

If you want fixes and features from upstream Octoladder:

```sh
git remote add upstream https://github.com/tnagatomi/octoladder
git fetch upstream
git merge upstream/main
```

`data/state.json` is only modified by your sync runs (never upstream),
so merges typically don't conflict on it.

## Local development

```sh
bundle install
bundle exec rake test       # run the test suite
GITHUB_TOKEN=ghp_xxx bundle exec ruby bin/sync   # local sync into data/state.json
bundle exec ruby bin/build  # render to site/
open site/index.html
```

Ruby version: see `.ruby-version`. ActiveSupport, Octokit, Minitest, and
WebMock are the only runtime/test dependencies.

## Troubleshooting

- **"GITHUB_TOKEN is not set"** in the workflow log: the
  `OCTOLADDER_GITHUB_TOKEN` secret is missing or misnamed.
- **`Octokit::NotFound` on a team**: the PAT's user can't see that team.
  Either the team slug is wrong or the user lacks `read:org` for that
  org.
- **`ResultsTruncated` for a user**: that user has more than 1000 merged
  PRs in the search window, which is GitHub's API hard cap. Narrow the
  backfill anchor (currently fixed at "Jan 1 of the previous calendar
  year"; edit `lib/octoladder/config.rb#backfill_anchor` to override).
- **Pages deploy fails with `Get Pages site failed`**: Pages source isn't
  set to "GitHub Actions" yet. Re-do step 4 of setup.
