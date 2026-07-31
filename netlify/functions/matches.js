import {
  getClient,
  ensureSchema,
  jsonResponse,
  validateGame,
  isoWeekKey,
  todayIso,
  getSession,
  fullName,
} from "./utils/db.mjs";

export default async (req) => {
  const db = getClient();
  await ensureSchema(db);
  const url = new URL(req.url);

  if (req.method === "GET") {
    const week = url.searchParams.get("week");
    const result = await db.execute(`
      SELECT m.id, m.score_a, m.score_b, m.played_at,
             pa.id AS player_a_id, pa.name AS player_a_name, pa.surname AS player_a_surname,
             pb.id AS player_b_id, pb.name AS player_b_name, pb.surname AS player_b_surname
      FROM matches m
      JOIN players pa ON pa.id = m.player_a_id
      JOIN players pb ON pb.id = m.player_b_id
      ORDER BY m.played_at DESC, m.id DESC
    `);
    const matches = result.rows
      .map((r) => {
        const playerA = { id: r.player_a_id, name: r.player_a_name, surname: r.player_a_surname };
        const playerB = { id: r.player_b_id, name: r.player_b_name, surname: r.player_b_surname };
        return {
          id: r.id,
          player_a: playerA,
          player_b: playerB,
          score_a: r.score_a,
          score_b: r.score_b,
          played_at: r.played_at,
          week: isoWeekKey(r.played_at),
          winner: r.score_a > r.score_b ? fullName(playerA) : fullName(playerB),
        };
      })
      .filter((m) => !week || m.week === week);
    return jsonResponse(matches);
  }

  if (req.method === "POST") {
    const session = getSession(req);
    if (!session) return jsonResponse({ error: "Please log in to record a match." }, 401);

    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const playerAId = parseInt(body.player_a_id, 10);
    const playerBId = parseInt(body.player_b_id, 10);
    const scoreA = parseInt(body.score_a, 10);
    const scoreB = parseInt(body.score_b, 10);
    if ([playerAId, playerBId, scoreA, scoreB].some(Number.isNaN)) {
      return jsonResponse({ error: "player_a_id, player_b_id, score_a, score_b are required" }, 400);
    }
    if (playerAId === playerBId) {
      return jsonResponse({ error: "A player can't play against themselves" }, 400);
    }

    const error = validateGame(scoreA, scoreB);
    if (error) return jsonResponse({ error }, 400);

    let playedAt = (body.played_at || "").trim();
    if (!playedAt) {
      playedAt = todayIso();
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(playedAt)) {
      return jsonResponse({ error: "played_at must be an ISO date (YYYY-MM-DD)" }, 400);
    }

    const existing = await db.execute({
      sql: "SELECT id FROM players WHERE id IN (?, ?)",
      args: [playerAId, playerBId],
    });
    if (existing.rows.length !== 2) {
      return jsonResponse({ error: "Unknown player id" }, 400);
    }

    const result = await db.execute({
      sql: `INSERT INTO matches (player_a_id, player_b_id, score_a, score_b, played_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      args: [playerAId, playerBId, scoreA, scoreB, playedAt, new Date().toISOString()],
    });

    // Clear any accepted challenge between these two players now that it's been played.
    await db.execute({
      sql: `UPDATE match_requests SET status = 'completed', responded_at = ?
            WHERE status = 'accepted'
              AND ((requester_id = ? AND opponent_id = ?) OR (requester_id = ? AND opponent_id = ?))`,
      args: [new Date().toISOString(), playerAId, playerBId, playerBId, playerAId],
    });

    return jsonResponse({ id: result.rows[0].id }, 201);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/matches",
  method: ["GET", "POST"],
};
