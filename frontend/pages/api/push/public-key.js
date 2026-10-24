import { proxyAuthenticated } from "../../../lib/serverApi";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return proxyAuthenticated(req, res, "/push/public-key");
}
