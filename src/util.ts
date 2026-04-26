// ISO 8601 string truncated to seconds (e.g., 2026-04-27T17:00:00Z), to match
// the format GitHub's search API expects and the format the Ruby state.json
// schema settled on. Date#toISOString includes milliseconds; we strip them.
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
