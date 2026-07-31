import { getSession, jsonResponse, fullName } from "./utils/db.mjs";

export default async (req) => {
  const session = getSession(req);
  if (!session) return jsonResponse({ player: null });
  return jsonResponse({
    player: {
      id: session.id,
      name: session.name,
      surname: session.surname,
      fullName: fullName(session),
    },
  });
};

export const config = {
  path: "/api/auth/me",
  method: ["GET"],
};
