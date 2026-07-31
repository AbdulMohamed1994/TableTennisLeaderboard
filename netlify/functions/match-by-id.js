import { getClient, ensureSchema, jsonResponse, getSession } from "./utils/db.mjs";

export default async (req, context) => {
  const session = getSession(req);
  if (!session) return jsonResponse({ error: "Please log in to delete a match." }, 401);

  const db = getClient();
  await ensureSchema(db);

  const id = parseInt(context.params.id, 10);
  if (Number.isNaN(id)) return jsonResponse({ error: "Invalid match id" }, 400);

  const result = await db.execute({
    sql: "DELETE FROM matches WHERE id = ? RETURNING id",
    args: [id],
  });
  if (result.rows.length === 0) return jsonResponse({ error: "Match not found" }, 404);
  return jsonResponse({ deleted: id });
};

export const config = {
  path: "/api/matches/:id",
  method: ["DELETE"],
};
