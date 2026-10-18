import { getServerSession } from "next-auth/next";
import { authOptions } from "../pages/api/auth/[...nextauth]";

export async function proxyAuthenticated(req, res, path) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.appUserId) {
    return res.status(401).json({ error: "Sign in to continue" });
  }

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const method = req.method || "GET";
  const body = {
    ...(req.body || {}),
    userId: session.appUserId,
  };

  const response = await fetch(`${apiBaseUrl}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET,
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });

  const data = await response.json().catch(() => ({}));

  return res.status(response.status).json(data);
}
