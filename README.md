# Octoladder

Visualize and rank merged-PR contributions of members of one or more GitHub organizations. Distributed as a **composite GitHub Action**: operators add a single workflow file to their own repository, the action does the rest, and upgrades arrive as small `dependabot` PRs that bump the action's version pin.

## How it works

The action runs in the operator's repository each week (or on manual dispatch):

1. Reconciles tracked GitHub team membership across one or more orgs.
2. Fetches newly merged PRs by tracked authors via GitHub's search API.
3. Persists the canonical state in `data/state.json` (committed back to the operator's repo).
4. Renders a static site to `site/` with weekly, monthly, and yearly ranking views, plus a per-contributor detail page for each ranked author listing their merged PRs grouped by repository.
5. The operator's workflow uploads `site/` to GitHub Pages.

Period boundaries (Mon–Sun weekly, calendar months, calendar years) honor the configured time zone (default `Asia/Tokyo`).

## Operator setup

You'll need a fresh repository in your org to host the configuration, the generated state, and the published Pages site.

### 1. Create the repository

A bare repository is enough — the action provides all the code. The operator-side files are just configuration:

```
your-octoladder-repo/
├── .github/
│   ├── workflows/sync.yml      # the workflow below
│   └── dependabot.yml          # optional: auto-PR action upgrades
├── config/
│   └── teams.yml               # the teams to track
└── data/state.json             # generated; not committed by hand
```

### 2. Add the workflow

Save this as `.github/workflows/sync.yml`:

```yaml
name: Sync and publish

on:
  # Monday 02:00 Asia/Tokyo (= Sunday 17:00 UTC). Adjust for your TZ
  # (Actions cron is UTC-only).
  schedule:
    - cron: "0 17 * * 0"
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  sync-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Run Octoladder
        uses: tnagatomi/octoladder@v1
        with:
          token: ${{ secrets.OCTOLADDER_GITHUB_TOKEN }}

      - name: Commit refreshed state
        run: |
          if [[ -n "$(git status --porcelain data/state.json)" ]]; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add data/state.json
            git commit -m "chore: refresh state $(date -u +%Y-%m-%dT%H:%M:%SZ)"
            # If a concurrent workflow pushed first, both states are valid
            # sync outputs — keep this run's because it ran later and saw
            # the more recent GitHub API state.
            git pull --rebase -X theirs origin main
            git push
          fi

      - uses: actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: site
      - uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5.0.0
        id: deploy
```

### 3. Add `config/teams.yml`

```yaml
- org: your-org
  team_slug: engineering
- org: another-org
  team_slug: platform
```

### 4. Add the Personal Access Token

Create a classic PAT with `read:org` scope at [github.com/settings/tokens](https://github.com/settings/tokens) and add it as the repository secret named **`OCTOLADDER_GITHUB_TOKEN`** (Settings → Secrets and variables → Actions).

The default `GITHUB_TOKEN` cannot read team membership across orgs (no `members:read` permission exists for it), which is why a PAT is required.

The PAT is issued under your own GitHub account; admin approval is generally **not** required. Caveats:

- **SAML SSO orgs.** On the PAT page, click `Configure SSO` and authorize the token for each org. Self-service, no admin needed.
- **Secret teams.** The PAT can only read members of teams you can see in the UI. If `teams.yml` lists a secret team, you must be a member (or an org admin).
- **Multi-org setups.** You must be a member of every org listed.

### 5. Enable GitHub Pages

Settings → Pages → Build and deployment:

- Source: **GitHub Actions**
- Visibility: **Private** (Enterprise required for private Pages; access is governed by repo read permission)

### 6. Run the first sync

Actions tab → "Sync and publish" → **Run workflow**. The first run backfills to January 1 of the previous calendar year, so weekly / monthly / yearly views are populated on day one. After that, the schedule takes over.

### 7. (Optional) Auto-update the action

Add `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

Dependabot will open PRs whenever `tnagatomi/octoladder` (or the other pinned actions) ships a new version. Merge to upgrade.

## Action inputs

| Input          | Required | Default                  | Description                                           |
| -------------- | -------- | ------------------------ | ----------------------------------------------------- |
| `token`        | yes      | —                        | Classic PAT with `read:org` scope                     |
| `config-path`  | no       | `config/octoladder.yml`  | Path to runtime config (see below)                    |
| `teams-path`   | no       | `config/teams.yml`       | Path to tracked teams list                            |
| `state-path`   | no       | `data/state.json`        | Path where state is persisted                         |
| `output-dir`   | no       | `site`                   | Directory where the static site is rendered          |

## Optional: `config/octoladder.yml`

```yaml
time_zone: Asia/Tokyo   # IANA name; default: Asia/Tokyo
min_stars: 20           # repo star floor; default: 20
```

If you change the time zone, also adjust the cron expression in your workflow so the schedule fires on Monday morning local time (Actions cron is UTC-only).

`min_stars` filters merged PRs by the star count of the repository they were merged into (applied as the `stars:>=N` qualifier on GitHub PR search). Set to `0` to disable the floor and count every public merged PR.

## Operating

**Add or remove a team.** Edit `config/teams.yml`, commit, push. The next sync picks it up. Or trigger "Sync and publish" manually for immediate effect.

**Member turnover.** Handled on GitHub. The next sync reflects it: new members start being tracked, removed members are marked inactive. Their historical PRs stay in past rankings; only future PR fetching stops.

**Recovering from a bad sync.** Revert the offending commit on `data/state.json` and re-run the workflow. State lives in git, so recovery is `git revert`.

## Local development (this repository)

```sh
npm install
npm test               # vitest
npm run type-check     # tsc --noEmit
npm run build          # bundle dist/index.js with @vercel/ncc
```

`dist/` must be re-committed whenever `src/` changes — a `check-dist` workflow guards against drift on PR.

## Troubleshooting

- **`Octokit::NotFound` / 404 on a team**: the PAT can't see that team (wrong slug, secret team you're not a member of, SSO not authorized for the org).
- **`ResultsTruncated` for a user**: that user has more than 1000 merged PRs in the search window, which is GitHub's API hard cap.
- **Pages deploy fails with `Get Pages site failed`**: Pages source isn't set to "GitHub Actions" yet. Re-do step 5 of setup.
- **Push rejected on the state commit**: a concurrent commit landed on `main` between checkout and push. The workflow's `git pull --rebase` handles the common case; re-run the workflow to retry.
