import { jsonResponse, clearSessionCookieHeader } from "./utils/db.mjs";

export default async () => {
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
};

export const config = {
  path: "/api/auth/logout",
  method: ["POST"],
};
