export default function LoadingButton({
  loading = false,
  disabled = false,
  className = "",
  children,
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      className={`loading-button ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="button-spinner" role="status" aria-label="Loading" />}
      <span className="loading-button-label">{children}</span>
    </button>
  );
}
