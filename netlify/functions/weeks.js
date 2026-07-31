import { getClient, ensureSchema, jsonResponse, isoWeekKey, todayIso } from "./utils/db.mjs";

export default async () => {
  const db = getClient();
  await ensureSchema(db);

  const result = await db.execute("SELECT DISTINCT played_at FROM matches");
  const weeks = Array.from(new Set(result.rows.map((r) => isoWeekKey(r.played_at))))
    .sort()
    .reverse();
  const current_week = isoWeekKey(todayIso());
  return jsonResponse({ weeks, current_week });
};

export const config = {
  path: "/api/weeks",
  method: ["GET"],
};
