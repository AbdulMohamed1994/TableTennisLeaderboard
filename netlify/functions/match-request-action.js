import { getClient, ensureSchema, jsonResponse, getSession } from "./utils/db.mjs";

const RESPONDER_ACTIONS = { accept: "accepted", decline: "declined" };

export default async (req, context) => {
  const session = getSession(req);
  if (!session) return jsonResponse({ error: "Please log in." }, 401);

  const db = getClient();
  await ensureSchema(db);

  const id = parseInt(context.params.id, 10);
  if (Number.isNaN(id)) return jsonResponse({ error: "Invalid request id" }, 400);

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const action = body.action;
  if (!["accept", "decline", "cancel"].includes(action)) {
    return jsonResponse({ error: "action must be accept, decline, or cancel" }, 400);
  }

  const existing = await db.execute({
    sql: "SELECT id, requester_id, opponent_id, status FROM match_requests WHERE id = ?",
    args: [id],
  });
  const request = existing.rows[0];
  if (!request) return jsonResponse({ error: "Request not found" }, 404);
  if (request.status !== "pending") {
    return jsonResponse({ error: "This request has already been resolved" }, 409);
  }

  if (action === "cancel") {
    if (request.requester_id !== session.id) {
      return jsonResponse({ error: "Only the requester can cancel this" }, 403);
    }
  } else if (request.opponent_id !== session.id) {
    return jsonResponse({ error: "Only the invited player can respond to this" }, 403);
  }

  const newStatus = action === "cancel" ? "cancelled" : RESPONDER_ACTIONS[action];
  await db.execute({
    sql: "UPDATE match_requests SET status = ?, responded_at = ? WHERE id = ?",
    args: [newStatus, new Date().toISOString(), id],
  });

  return jsonResponse({ id, status: newStatus });
};

export const config = {
  path: "/api/match-requests/:id",
  method: ["POST"],
};
