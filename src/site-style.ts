// Bundled with the action so ncc can pack it into dist/index.js without a
// runtime asset lookup.
export const SITE_STYLE_CSS = `:root {
  --fg: #1f2328;
  --muted: #57606a;
  --border: #d0d7de;
  --bg: #ffffff;
  --accent: #0969da;
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

.period-type {
  margin: 0;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

h1 { margin: 0.25rem 0 0.5rem; font-size: 1.5rem; }

.subtitle { margin: 0; color: var(--muted); }

.period-nav {
  margin: 1rem 0 2rem;
  display: flex;
  justify-content: space-between;
}

.period-nav a { color: var(--accent); text-decoration: none; }
.period-nav a:hover { text-decoration: underline; }
.period-nav .disabled { color: var(--border); }

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

td.rank { width: 3rem; color: var(--muted); }
td.count { width: 4rem; text-align: right; font-variant-numeric: tabular-nums; }

td.contributor { display: flex; align-items: center; gap: 0.5rem; }
td.contributor img { border-radius: 50%; }

.inactive { color: var(--muted); font-size: 0.85rem; }
.empty { color: var(--muted); font-style: italic; }
.totals { margin-top: 1rem; color: var(--muted); font-size: 0.9rem; }
`;
