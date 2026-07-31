import { getClient, ensureSchema, jsonResponse } from "./utils/db.mjs";

export default async (req) => {
  const db = getClient();
  await ensureSchema(db);

  if (req.method === "GET") {
    const result = await db.execute("SELECT id, name FROM players ORDER BY name COLLATE NOCASE");
    return jsonResponse(result.rows);
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    const name = (body.name || "").trim();
    if (!name) return jsonResponse({ error: "Player name is required" }, 400);
    if (name.length > 40) return jsonResponse({ error: "Player name is too long" }, 400);

    try {
      const result = await db.execute({
        sql: "INSERT INTO players (name) VALUES (?) RETURNING id, name",
        args: [name],
      });
      return jsonResponse(result.rows[0], 201);
    } catch (err) {
      if (String(err.message || err).toLowerCase().includes("unique")) {
        return jsonResponse({ error: "A player with that name already exists" }, 409);
      }
      throw err;
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/players",
  method: ["GET", "POST"],
};
