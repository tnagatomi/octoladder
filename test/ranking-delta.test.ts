import { describe, expect, it } from "vitest";
import { Ranking } from "../src/ranking.js";
import { computeRankDeltas } from "../src/ranking-delta.js";

const idOf = (u: string) => u;

describe("computeRankDeltas", () => {
  it("returns positive delta when rank improved", () => {
    const previous = new Ranking([
      { user: "a", count: 3 },
      { user: "b", count: 5 },
    ]);
    const current = new Ranking([
      { user: "a", count: 10 },
      { user: "b", count: 5 },
    ]);
    const deltas = computeRankDeltas(current, previous, idOf);
    expect(deltas.get("a")).toBe(1);
    expect(deltas.get("b")).toBe(-1);
  });

  it("returns 0 when rank is unchanged", () => {
    const previous = new Ranking([
      { user: "a", count: 5 },
      { user: "b", count: 3 },
    ]);
    const current = new Ranking([
      { user: "a", count: 7 },
      { user: "b", count: 4 },
    ]);
    const deltas = computeRankDeltas(current, previous, idOf);
    expect(deltas.get("a")).toBe(0);
    expect(deltas.get("b")).toBe(0);
  });

  it("returns null for users not in previous ranking", () => {
    const previous = new Ranking([{ user: "a", count: 5 }]);
    const current = new Ranking([
      { user: "a", count: 5 },
      { user: "b", count: 3 },
    ]);
    const deltas = computeRankDeltas(current, previous, idOf);
    expect(deltas.get("a")).toBe(0);
    expect(deltas.get("b")).toBeNull();
  });

  it("returns null for every user when previous is null", () => {
    const current = new Ranking([
      { user: "a", count: 5 },
      { user: "b", count: 3 },
    ]);
    const deltas = computeRankDeltas(current, null, idOf);
    expect(deltas.get("a")).toBeNull();
    expect(deltas.get("b")).toBeNull();
  });

  it("handles tied ranks the same way as competitive ranking", () => {
    // previous: a=1, b=1 (tied), c=3
    // current:  a=1, b=2, c=2 (b and c tied at 2)
    const previous = new Ranking([
      { user: "a", count: 5 },
      { user: "b", count: 5 },
      { user: "c", count: 3 },
    ]);
    const current = new Ranking([
      { user: "a", count: 10 },
      { user: "b", count: 4 },
      { user: "c", count: 4 },
    ]);
    const deltas = computeRankDeltas(current, previous, idOf);
    expect(deltas.get("a")).toBe(0); // 1 -> 1
    expect(deltas.get("b")).toBe(-1); // 1 -> 2
    expect(deltas.get("c")).toBe(1); // 3 -> 2
  });

  it("uses getKey to identify users across rankings", () => {
    type U = { login: string; name: string };
    const a1: U = { login: "a", name: "Alice" };
    const a2: U = { login: "a", name: "Alice the Second" };
    const previous = new Ranking<U>([{ user: a1, count: 3 }]);
    const current = new Ranking<U>([{ user: a2, count: 5 }]);
    const deltas = computeRankDeltas(current, previous, (u) => u.login);
    expect(deltas.get("a")).toBe(0);
  });

  it("only includes current ranking's users in the result", () => {
    const previous = new Ranking([
      { user: "a", count: 5 },
      { user: "b", count: 3 },
    ]);
    const current = new Ranking([{ user: "a", count: 7 }]);
    const deltas = computeRankDeltas(current, previous, idOf);
    expect([...deltas.keys()]).toEqual(["a"]);
  });

  it("returns empty map when current ranking is empty", () => {
    const previous = new Ranking([{ user: "a", count: 5 }]);
    const current = new Ranking<string>([]);
    expect(computeRankDeltas(current, previous, idOf).size).toBe(0);
    expect(computeRankDeltas(current, null, idOf).size).toBe(0);
  });
});
