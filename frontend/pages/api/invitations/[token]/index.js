export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = req.query.token;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Invitation token is required" });
  }

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  try {
    const userId = typeof req.query.userId === "string" ? req.query.userId : "";
    const lookupUrl = new URL(`${apiBaseUrl}/api/invitations/${encodeURIComponent(token)}`);
    if (userId) lookupUrl.searchParams.set("userId", userId);

    const response = await fetch(lookupUrl.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET,
        },
      },
    );

    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: "Could not retrieve invitation" });
  }
}
