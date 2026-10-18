import { useEffect, useState } from "react";

const TOAST_DURATION_MS = 3200;

export default function ToastHost() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let dismissTimer;

    function handleToast(event) {
      window.clearTimeout(dismissTimer);
      setToast(event.detail || null);

      dismissTimer = window.setTimeout(() => {
        setToast(null);
      }, TOAST_DURATION_MS);
    }

    window.addEventListener("splitshare:toast", handleToast);

    return () => {
      window.clearTimeout(dismissTimer);
      window.removeEventListener("splitshare:toast", handleToast);
    };
  }, []);

  if (!toast) return null;

  const isError = toast.type === "error";

  return (
    <div
      className={`toast toast-${isError ? "error" : "success"}`}
      role="status"
      aria-live={isError ? "assertive" : "polite"}
    >
      <span aria-hidden="true">{isError ? "⚠" : "✓"}</span>
      <span>{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => setToast(null)}
      >
        ×
      </button>
    </div>
  );
}
