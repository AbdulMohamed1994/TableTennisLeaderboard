import { getClient, ensureSchema, jsonResponse, isoWeekKey, fullName } from "./utils/db.mjs";

const STARTING_ELO = 1500;
const K_FACTOR = 32;

function applyElo(elo, aId, bId, aWon) {
  const ra = elo.get(aId);
  const rb = elo.get(bId);
  const expectedA = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const scoreA = aWon ? 1 : 0;
  elo.set(aId, ra + K_FACTOR * (scoreA - expectedA));
  elo.set(bId, rb + K_FACTOR * (1 - scoreA - (1 - expectedA)));
}

export default async (req) => {
  const db = getClient();
  await ensureSchema(db);
  const url = new URL(req.url);
  const week = url.searchParams.get("week");

  const playersResult = await db.execute("SELECT id, name, surname FROM players");
  const matchesResult = await db.execute(
    "SELECT id, player_a_id, player_b_id, score_a, score_b, played_at FROM matches ORDER BY played_at ASC, id ASC",
  );

  const stats = new Map();
  const elo = new Map();
  const eloBeforeScope = new Map();
  const eloAfterScope = new Map();
  for (const p of playersResult.rows) {
    stats.set(p.id, {
      id: p.id,
      name: p.name,
      full_name: fullName(p),
      played: 0,
      wins: 0,
      losses: 0,
      points_scored: 0,
      points_conceded: 0,
    });
    elo.set(p.id, STARTING_ELO);
  }

  // Elo is a running rating, not a per-week stat: it's always replayed across
  // the player's FULL match history (in order) so "current Elo" reflects
  // their real standing today regardless of which week is being viewed.
  // "Elo change" is scoped to the selected week (or all-time) by snapshotting
  // the rating just before and just after that window.
  for (const m of matchesResult.rows) {
    const a = stats.get(m.player_a_id);
    const b = stats.get(m.player_b_id);
    if (!a || !b) continue;
    const inScope = !week || isoWeekKey(m.played_at) === week;

    if (inScope) {
      if (!eloBeforeScope.has(a.id)) eloBeforeScope.set(a.id, elo.get(a.id));
      if (!eloBeforeScope.has(b.id)) eloBeforeScope.set(b.id, elo.get(b.id));
    }

    applyElo(elo, a.id, b.id, m.score_a > m.score_b);

    if (inScope) {
      eloAfterScope.set(a.id, elo.get(a.id));
      eloAfterScope.set(b.id, elo.get(b.id));

      a.played += 1;
      b.played += 1;
      a.points_scored += m.score_a;
      a.points_conceded += m.score_b;
      b.points_scored += m.score_b;
      b.points_conceded += m.score_a;
      if (m.score_a > m.score_b) {
        a.wins += 1;
        b.losses += 1;
      } else {
        b.wins += 1;
        a.losses += 1;
      }
    }
  }

  const board = Array.from(stats.values()).map((row) => {
    const point_diff = row.points_scored - row.points_conceded;
    const win_pct = row.played ? Math.round((1000 * row.wins) / row.played) / 10 : 0.0;
    const avg_points = row.played ? Math.round((10 * row.points_scored) / row.played) / 10 : 0.0;
    const currentElo = elo.get(row.id);
    const before = eloBeforeScope.has(row.id) ? eloBeforeScope.get(row.id) : currentElo;
    const after = eloAfterScope.has(row.id) ? eloAfterScope.get(row.id) : currentElo;
    return {
      ...row,
      point_diff,
      win_pct,
      avg_points,
      elo: Math.round(currentElo),
      elo_change: Math.round(after - before),
      _eloRaw: currentElo,
    };
  });

  board.sort(
    (x, y) =>
      y._eloRaw - x._eloRaw ||
      y.wins - x.wins ||
      y.point_diff - x.point_diff ||
      y.points_scored - x.points_scored ||
      x.name.localeCompare(y.name),
  );

  for (const row of board) delete row._eloRaw;

  return jsonResponse(board);
};

export const config = {
  path: "/api/leaderboard",
  method: ["GET"],
};
