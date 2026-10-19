import { proxyAuthenticated } from "../../../../lib/serverApi";

export default function handler(req, res) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return proxyAuthenticated(req, res, `/users/${req.query.id}/upi`);
}
