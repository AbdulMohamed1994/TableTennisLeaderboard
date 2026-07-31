import { createClient } from "@libsql/client";
import jwt from "jsonwebtoken";

const WIN_SCORE = 21;
const WIN_MARGIN = 2;
const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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
        name TEXT UNIQUE NOT NULL,
        surname TEXT,
        email TEXT,
        password_hash TEXT
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
      `CREATE TABLE IF NOT EXISTS match_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL REFERENCES players(id),
        opponent_id INTEGER NOT NULL REFERENCES players(id),
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        responded_at TEXT
      )`,
    ],
    "write",
  );

  // Older deployments created `players` with only id/name. Add the missing
  // columns in place with ALTER TABLE ADD COLUMN — no rename/rebuild, since
  // Turso enforces foreign keys by default and matches/match_requests both
  // reference this table (a rename-based rebuild trips SQLITE_CONSTRAINT).
  const tableInfo = await db.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'players'",
  );
  const createSql = tableInfo.rows[0]?.sql || "";
  for (const column of ["surname", "email", "password_hash"]) {
    if (!createSql.includes(column)) {
      await db.execute(`ALTER TABLE players ADD COLUMN ${column} TEXT`);
    }
  }

  await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players(email)");
}

export function fullName(row) {
  return row.surname ? `${row.name} ${row.surname}` : row.name;
}

export function signSession(player) {
  return jwt.sign(
    { id: player.id, name: player.name, surname: player.surname || null },
    process.env.SESSION_SECRET,
    { expiresIn: SESSION_MAX_AGE_SECONDS },
  );
}

export function parseCookies(req) {
  const header = req.headers.get("cookie") || "";
  const cookies = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

export function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
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

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignup({ name, surname, email, password }) {
  if (!name || !name.trim()) return "First name is required.";
  if (!surname || !surname.trim()) return "Surname is required.";
  if (!email || !EMAIL_RE.test(email.trim())) return "A valid email is required.";
  if (!password || password.length < 8) return "Password must be at least 8 characters.";
  return null;
}
