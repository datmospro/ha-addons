const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("../server/node_modules/better-sqlite3");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rover-counter-test-"));
process.env.DB_PATH = path.join(dir, "legacy.db");
// Create the previous schema and data before loading the upgraded application.
const old = new Database(process.env.DB_PATH);
old.exec(`CREATE TABLE teams(id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, players TEXT);
CREATE TABLE matches(id INTEGER PRIMARY KEY, game_id TEXT, status TEXT, settings TEXT, start_time TEXT, end_time TEXT);
CREATE TABLE match_teams(id INTEGER PRIMARY KEY, match_id INTEGER, team_id INTEGER, score INTEGER, FOREIGN KEY(team_id) REFERENCES teams(id));
CREATE TABLE match_history(id INTEGER PRIMARY KEY, match_id INTEGER, round INTEGER, team_id INTEGER NOT NULL, bid INTEGER, suit TEXT, success INTEGER, scoring_team_id INTEGER, dealer_index INTEGER, timestamp TEXT, FOREIGN KEY(team_id) REFERENCES teams(id));
INSERT INTO teams VALUES(1,'Ases','2026-01-01','["Ana","Luis"]'),(2,'Reyes','2026-01-01','["Eva","Marc"]');
INSERT INTO matches VALUES(1,'tute','active','{"targetScore":1001}','2026-01-01',NULL);
INSERT INTO match_teams VALUES(1,1,1,100),(2,1,2,0);
INSERT INTO match_history VALUES(1,1,1,1,100,'oros',1,1,0,'2026-01-01');`);
old.close();
const app = require("../server/index");
const db = require("../server/db");
let server, base;
const ready = new Promise((resolve) => {
  server = app.listen(0, "127.0.0.1", () => {
    base = `http://127.0.0.1:${server.address().port}/api`;
    resolve();
  });
});
const call = async (url, method = "GET", data) => {
  await ready;
  return fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
};
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});
test("legacy migration, skipped persistence, atomic rollback and finished protection", async () => {
  let response = await call("/matches?status=active");
  let [match] = await response.json();
  assert.equal(match.teams[0].score, 100);
  const deletion = await call("/teams/1", "DELETE");
  assert.equal(deletion.status, 409);
  assert.equal(match.history[0].skipped, false);
  const skipped = {
    round: 2,
    teamId: 1,
    bid: 0,
    suit: null,
    success: false,
    scoringTeamId: null,
    dealerIndex: 1,
    timestamp: "2026-01-02",
    skipped: true,
  };
  response = await call("/matches/1", "PUT", {
    teams: match.teams,
    history: [skipped, ...match.history],
  });
  assert.equal(response.status, 200);
  [match] = await (await call("/matches")).json();
  assert.equal(match.history[0].skipped, true);
  assert.equal(match.history[0].bid, 0);
  assert.equal(match.history[0].scoringTeamId, null);
  assert.equal(match.teams[0].score, 100);
  response = await call("/matches/1", "PUT", {
    teams: match.teams.map((t) => ({ ...t, score: 999 })),
    history: [{ ...skipped, teamId: 9999 }],
  });
  assert.equal(response.status, 500);
  [match] = await (await call("/matches")).json();
  assert.equal(match.teams[0].score, 100);
  assert.equal(match.history.length, 2);
  response = await call("/matches/1/finish", "POST");
  assert.equal(response.status, 200);
  response = await call("/matches/1", "PUT", {
    teams: match.teams,
    history: [],
  });
  assert.equal(response.status, 409);
  [match] = await (await call("/matches?status=finished")).json();
  assert.equal(match.history[0].skipped, true);
  assert.equal(match.history.length, 2);
});
