export function showToast(message, type = "success") {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("splitshare:toast", {
      detail: { message, type },
    }),
  );
}
