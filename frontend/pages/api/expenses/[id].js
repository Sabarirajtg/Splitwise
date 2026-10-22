import { proxyAuthenticated } from "../../../lib/serverApi";

export default function handler(req, res) {
  if (!["PUT", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "PUT, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return proxyAuthenticated(req, res, "/expenses/" + encodeURIComponent(req.query.id));
}
