import { getClient, ensureSchema, jsonResponse, getSession, fullName } from "./utils/db.mjs";

function mapRow(r) {
  const requester = { id: r.requester_id, name: r.requester_name, surname: r.requester_surname };
  const opponent = { id: r.opponent_id, name: r.opponent_name, surname: r.opponent_surname };
  return {
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    responded_at: r.responded_at,
    requester: { ...requester, full_name: fullName(requester) },
    opponent: { ...opponent, full_name: fullName(opponent) },
  };
}

export default async (req) => {
  const session = getSession(req);
  if (!session) return jsonResponse({ error: "Please log in." }, 401);

  const db = getClient();
  await ensureSchema(db);

  if (req.method === "GET") {
    const result = await db.execute({
      sql: `
        SELECT mr.id, mr.status, mr.created_at, mr.responded_at,
               req.id AS requester_id, req.name AS requester_name, req.surname AS requester_surname,
               opp.id AS opponent_id, opp.name AS opponent_name, opp.surname AS opponent_surname
        FROM match_requests mr
        JOIN players req ON req.id = mr.requester_id
        JOIN players opp ON opp.id = mr.opponent_id
        WHERE mr.requester_id = ? OR mr.opponent_id = ?
        ORDER BY mr.created_at DESC
      `,
      args: [session.id, session.id],
    });
    return jsonResponse(result.rows.map(mapRow));
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    const opponentId = parseInt(body.opponent_id, 10);
    if (Number.isNaN(opponentId)) return jsonResponse({ error: "opponent_id is required" }, 400);
    if (opponentId === session.id) {
      return jsonResponse({ error: "You can't request a match against yourself" }, 400);
    }

    const opponent = await db.execute({ sql: "SELECT id FROM players WHERE id = ?", args: [opponentId] });
    if (opponent.rows.length === 0) return jsonResponse({ error: "Unknown player id" }, 400);

    const existing = await db.execute({
      sql: `SELECT id FROM match_requests
            WHERE status = 'pending'
              AND ((requester_id = ? AND opponent_id = ?) OR (requester_id = ? AND opponent_id = ?))`,
      args: [session.id, opponentId, opponentId, session.id],
    });
    if (existing.rows.length > 0) {
      return jsonResponse({ error: "There's already a pending request between you two" }, 409);
    }

    const result = await db.execute({
      sql: `INSERT INTO match_requests (requester_id, opponent_id, status, created_at)
            VALUES (?, ?, 'pending', ?) RETURNING id`,
      args: [session.id, opponentId, new Date().toISOString()],
    });
    return jsonResponse({ id: result.rows[0].id }, 201);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/match-requests",
  method: ["GET", "POST"],
};
