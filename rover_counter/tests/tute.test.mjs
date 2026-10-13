import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendRound,
  dealerFor,
  normalizeHistory,
  scoresFromHistory,
} from "../web/src/utils/tute.mjs";
const base = () => ({
  teams: [
    { id: 1, score: 0 },
    { id: 2, score: 0 },
  ],
  history: [],
  settings: {
    startingDealerIndex: 1,
    playerOrder: [
      { name: "A", teamId: 1 },
      { name: "B", teamId: 2 },
      { name: "C", teamId: 1 },
      { name: "D", teamId: 2 },
    ],
  },
});
test("unplayed deal leaves both scores intact and advances dealer, including full rotation", () => {
  let match = base();
  for (let n = 0; n < 5; n++) {
    const state = appendRound(match, {}, false, true);
    assert.equal(state.history[0].skipped, true);
    assert.equal(state.history[0].dealerIndex, (1 + n) % 4);
    assert.deepEqual(
      state.teams.map((t) => t.score),
      [0, 0],
    );
    match = { ...match, ...state };
    assert.equal(dealerFor(match), (2 + n) % 4);
  }
});
test("mixed successful, skipped and failed deals score the correct teams", () => {
  let match = base();
  match = {
    ...match,
    ...appendRound(match, { teamId: 1, bid: 100, suit: "oros" }, true),
  };
  match = { ...match, ...appendRound(match, {}, false, true) };
  match = {
    ...match,
    ...appendRound(match, { teamId: 1, bid: 120, suit: "copas" }, false),
  };
  assert.deepEqual(
    match.teams.map((t) => t.score),
    [100, 120],
  );
  assert.deepEqual(
    match.history.map((r) => r.round),
    [3, 2, 1],
  );
  assert.deepEqual(
    match.history.map((r) => r.dealerIndex),
    [3, 2, 1],
  );
  assert.equal(match.history[1].scoringTeamId, null);
  const history = normalizeHistory(
    match,
    match.history.filter((r) => r.round !== 2),
  );
  assert.deepEqual(
    history.map((r) => r.dealerIndex),
    [2, 1],
  );
  assert.deepEqual(
    scoresFromHistory(match.teams, history).map((t) => t.score),
    [100, 120],
  );
  const undo = normalizeHistory(match, match.history.slice(1));
  assert.deepEqual(
    scoresFromHistory(match.teams, undo).map((t) => t.score),
    [100, 0],
  );
  assert.equal(dealerFor({ ...match, history: undo }), 3);
});
test("legacy rounds without a skipped field continue to count, edits recalculate totals", () => {
  const match = base();
  const history = [{ round: 1, teamId: 2, bid: 70, success: false }];
  assert.deepEqual(
    scoresFromHistory(match.teams, history).map((t) => t.score),
    [70, 0],
  );
  history[0].success = true;
  history[0].bid = 230;
  assert.deepEqual(
    scoresFromHistory(match.teams, history).map((t) => t.score),
    [0, 230],
  );
});
test("games with no named players safely omit dealer", () => {
  const match = { ...base(), settings: {} };
  assert.equal(dealerFor(match), null);
  assert.equal(
    appendRound(match, {}, false, true).history[0].dealerIndex,
    null,
  );
});
