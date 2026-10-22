import { proxyAuthenticated } from "../../../../lib/serverApi";

export default function handler(req, res) {
  if (!["POST"].includes(req.method)) {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return proxyAuthenticated(req, res, "/groups/" + encodeURIComponent(req.query.id) + "/expenses");
}
