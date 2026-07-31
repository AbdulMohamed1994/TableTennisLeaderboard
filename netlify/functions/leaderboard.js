import { getClient, ensureSchema, jsonResponse, isoWeekKey } from "./utils/db.mjs";

export default async (req) => {
  const db = getClient();
  await ensureSchema(db);
  const url = new URL(req.url);
  const week = url.searchParams.get("week");

  const playersResult = await db.execute("SELECT id, name FROM players");
  const matchesResult = await db.execute(
    "SELECT player_a_id, player_b_id, score_a, score_b, played_at FROM matches",
  );

  const stats = new Map();
  for (const p of playersResult.rows) {
    stats.set(p.id, {
      id: p.id,
      name: p.name,
      played: 0,
      wins: 0,
      losses: 0,
      points_scored: 0,
      points_conceded: 0,
    });
  }

  for (const m of matchesResult.rows) {
    if (week && isoWeekKey(m.played_at) !== week) continue;
    const a = stats.get(m.player_a_id);
    const b = stats.get(m.player_b_id);
    if (!a || !b) continue;
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

  const board = Array.from(stats.values()).map((row) => {
    const point_diff = row.points_scored - row.points_conceded;
    const win_pct = row.played ? Math.round((1000 * row.wins) / row.played) / 10 : 0.0;
    const avg_points = row.played ? Math.round((10 * row.points_scored) / row.played) / 10 : 0.0;
    return { ...row, point_diff, win_pct, avg_points };
  });

  board.sort(
    (x, y) =>
      y.wins - x.wins ||
      y.point_diff - x.point_diff ||
      y.points_scored - x.points_scored ||
      x.name.localeCompare(y.name),
  );

  return jsonResponse(board);
};

export const config = {
  path: "/api/leaderboard",
  method: ["GET"],
};
