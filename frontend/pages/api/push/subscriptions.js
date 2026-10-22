import { proxyAuthenticated } from "../../../lib/serverApi";

export default function handler(req, res) {
  if (!["POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return proxyAuthenticated(req, res, "/push/subscriptions");
}
