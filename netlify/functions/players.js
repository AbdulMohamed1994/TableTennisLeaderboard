import { getClient, ensureSchema, jsonResponse } from "./utils/db.mjs";

export default async () => {
  const db = getClient();
  await ensureSchema(db);

  const result = await db.execute("SELECT id, name, surname FROM players ORDER BY name COLLATE NOCASE");
  return jsonResponse(result.rows);
};

export const config = {
  path: "/api/players",
  method: ["GET"],
};
