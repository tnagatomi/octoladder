// Bundled with the action so ncc can pack it into dist/index.js without a
// runtime asset lookup.
export const SITE_STYLE_CSS = `:root {
  --fg: #1f2328;
  --muted: #57606a;
  --border: #d0d7de;
  --bg: #ffffff;
  --accent: #0969da;
  --rank-up: #1a6e34;
  --rank-down: #a4222a;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--fg);
  background: var(--bg);
  line-height: 1.5;
}

main {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.period-tabs {
  display: flex;
  gap: 1rem;
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.period-tabs a { color: var(--muted); text-decoration: none; }
.period-tabs a:hover { text-decoration: underline; }
.period-tabs a[aria-current="page"] { color: var(--fg); font-weight: 600; }
.period-tabs .disabled { color: var(--border); }

h1 { margin: 0.25rem 0 0.5rem; font-size: 1.5rem; }

.subtitle { margin: 0; color: var(--muted); }

.period-nav {
  margin: 1rem 0 2rem;
  display: flex;
  justify-content: space-between;
}

.period-nav a { color: var(--accent); text-decoration: none; }
.period-nav a:hover { text-decoration: underline; }

table.ranking {
  width: 100%;
  border-collapse: collapse;
}

table.ranking th, table.ranking td {
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
}

table.ranking th { font-weight: 600; color: var(--muted); }

td.rank { width: 4rem; color: var(--muted); font-variant-numeric: tabular-nums; }
td.rank .rank-num { color: var(--fg); }
td.rank .rank-delta-up { color: var(--rank-up); font-size: 0.85rem; }
td.rank .rank-delta-down { color: var(--rank-down); font-size: 0.85rem; }
td.rank .rank-delta-none { color: var(--border); font-size: 0.85rem; }
td.count { width: 4rem; text-align: right; font-variant-numeric: tabular-nums; }

td.contributor { display: flex; align-items: center; gap: 0.5rem; }
td.contributor img { border-radius: 50%; }

.inactive { color: var(--muted); font-size: 0.85rem; }
.empty { color: var(--muted); font-style: italic; }
.totals { margin-top: 1rem; color: var(--muted); font-size: 0.9rem; }

td.contributor a { color: var(--accent); text-decoration: none; }
td.contributor a:hover { text-decoration: underline; }

a.back {
  display: inline-block;
  margin-bottom: 1rem;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
}
a.back:hover { text-decoration: underline; }

.profile-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.profile-card img { border-radius: 50%; }
.profile-card h1 { margin: 0; font-size: 1.5rem; }
.profile-card h1 a { color: var(--fg); text-decoration: none; }
.profile-card h1 a:hover { text-decoration: underline; }
.profile-card .summary { margin: 0.25rem 0 0; color: var(--muted); }

.repo-group { margin: 1.5rem 0; }
.repo-group h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 600;
}
.repo-group h2 a { color: var(--fg); text-decoration: none; }
.repo-group h2 a:hover { text-decoration: underline; }

ul.prs {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}

ul.prs li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

ul.prs a { color: var(--accent); text-decoration: none; }
ul.prs a:hover { text-decoration: underline; }
ul.prs time {
  color: var(--muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
`;
