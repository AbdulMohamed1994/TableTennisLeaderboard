import bcrypt from "bcryptjs";
import { getClient, ensureSchema, jsonResponse, signSession, sessionCookieHeader, fullName } from "./utils/db.mjs";

export default async (req) => {
  const db = getClient();
  await ensureSchema(db);

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) {
    return jsonResponse({ error: "Email and password are required" }, 400);
  }

  const result = await db.execute({
    sql: "SELECT id, name, surname, password_hash FROM players WHERE lower(email) = ? AND password_hash IS NOT NULL",
    args: [email],
  });

  const row = result.rows[0];
  const valid = row ? await bcrypt.compare(password, row.password_hash) : false;
  if (!valid) {
    return jsonResponse({ error: "Invalid email or password" }, 401);
  }

  const player = { id: row.id, name: row.name, surname: row.surname };
  const token = signSession(player);
  return jsonResponse(
    { id: player.id, name: player.name, surname: player.surname, fullName: fullName(player) },
    200,
    { "Set-Cookie": sessionCookieHeader(token) },
  );
};

export const config = {
  path: "/api/auth/login",
  method: ["POST"],
};
