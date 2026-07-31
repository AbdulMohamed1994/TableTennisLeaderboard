import bcrypt from "bcryptjs";
import {
  getClient,
  ensureSchema,
  jsonResponse,
  validateSignup,
  signSession,
  sessionCookieHeader,
  fullName,
} from "./utils/db.mjs";

export default async (req) => {
  const db = getClient();
  await ensureSchema(db);

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const name = (body.name || "").trim();
  const surname = (body.surname || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  const error = validateSignup({ name, surname, email, password });
  if (error) return jsonResponse({ error }, 400);

  const existingAccount = await db.execute({
    sql: "SELECT id FROM players WHERE lower(email) = ? AND password_hash IS NOT NULL",
    args: [email],
  });
  if (existingAccount.rows.length > 0) {
    return jsonResponse({ error: "An account with that email already exists" }, 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Claim an existing unclaimed player row with a matching first name (created
  // before accounts existed) so past match history stays attached, instead of
  // starting this person at zero.
  const unclaimed = await db.execute({
    sql: "SELECT id FROM players WHERE lower(name) = lower(?) AND password_hash IS NULL LIMIT 1",
    args: [name],
  });

  let player;
  if (unclaimed.rows.length > 0) {
    const id = unclaimed.rows[0].id;
    await db.execute({
      sql: "UPDATE players SET surname = ?, email = ?, password_hash = ? WHERE id = ?",
      args: [surname, email, passwordHash, id],
    });
    player = { id, name, surname };
  } else {
    const result = await db.execute({
      sql: `INSERT INTO players (name, surname, email, password_hash)
            VALUES (?, ?, ?, ?) RETURNING id`,
      args: [name, surname, email, passwordHash],
    });
    player = { id: result.rows[0].id, name, surname };
  }

  const token = signSession(player);
  return jsonResponse(
    { id: player.id, name: player.name, surname: player.surname, fullName: fullName(player) },
    201,
    { "Set-Cookie": sessionCookieHeader(token) },
  );
};

export const config = {
  path: "/api/auth/signup",
  method: ["POST"],
};
