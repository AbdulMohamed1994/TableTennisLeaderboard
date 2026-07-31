import { createClient } from "@libsql/client";

const WIN_SCORE = 21;
const WIN_MARGIN = 2;

let client;

export function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

export async function ensureSchema(db) {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_a_id INTEGER NOT NULL REFERENCES players(id),
        player_b_id INTEGER NOT NULL REFERENCES players(id),
        score_a INTEGER NOT NULL,
        score_b INTEGER NOT NULL,
        played_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ],
    "write",
  );
}

export function validateGame(scoreA, scoreB) {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
    return "Scores must be whole numbers.";
  }
  if (scoreA < 0 || scoreB < 0) return "Scores can't be negative.";
  if (scoreA === scoreB) return "A match can't end in a tie.";
  const winner = Math.max(scoreA, scoreB);
  const loser = Math.min(scoreA, scoreB);
  if (winner < WIN_SCORE) return `Winning score must be at least ${WIN_SCORE}.`;
  if (winner - loser < WIN_MARGIN) return `Winner must win by at least ${WIN_MARGIN} points.`;
  return null;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Matches Python's date.isocalendar() ISO 8601 week numbering (Mon-start weeks,
// week 1 contains the year's first Thursday) so weeks line up with the old app.
export function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const target = new Date(d.getTime());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const weekNumber = 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
