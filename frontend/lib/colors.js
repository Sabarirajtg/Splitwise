const PALETTE = ["#7c3aed", "#0ea892", "#ff6b5e", "#f5a524", "#3b82f6", "#ec4899", "#22c55e", "#6366f1"];

export function avatarColor(id) {
  let hash = 0;
  for (let i = 0; i < (id || "").length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
