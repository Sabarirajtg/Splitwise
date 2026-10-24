import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useSession, signIn } from "next-auth/react";
import { setSession } from "../lib/api";
import LoadingButton from "../components/LoadingButton";

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.27-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.82.9 4.03l3.05-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

export default function Login() {
  const router = useRouter();
  const { data: googleSession, status } = useSession();
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  async function startGoogleSignIn() {
    if (signingIn || status === "loading") return;
    setError("");
    setSigningIn(true);
    try {
      await signIn("google");
    } catch (signInError) {
      setError(signInError.message || "Could not start Google sign-in");
      setSigningIn(false);
    }
  }

  // Bridge: once NextAuth confirms a Google sign-in and our backend has
  // synced/created the matching app user, drop it into the same localStorage
  // session the rest of the app already reads via lib/api.js.
  useEffect(() => {
    if (status !== "authenticated" || !googleSession) return;

    if (googleSession.appError) {
      setError(googleSession.appError);
      setSigningIn(false);
      return;
    }

    if (!googleSession.appUserId) {
      setError(
        "Google sign-in succeeded, but SplitShare could not create your app session. " +
        "Check the frontend/backend URL settings and Google OAuth callback URL, then try again."
      );
      return;
    }

    setSession({ id: googleSession.appUserId, name: googleSession.appUserName });
    const next =
      typeof router.query.next === "string" && router.query.next.startsWith("/")
        ? router.query.next
        : "/groups";
    router.replace(next);
  }, [status, googleSession, router]);

  return (
    <div className="container" style={{ paddingTop: 100, textAlign: "center" }}>
      <div className="logo-hero">💸</div>
      <h1 style={{ fontSize: 26 }}>
        <span className="brand-gradient-text">SplitShare</span>
      </h1>
      <p className="muted" style={{ marginBottom: 10 }}>Split expenses with your group, in any currency</p>
      <p style={{ marginBottom: 40 }} className="brand-gradient-text muted">by Sabsh ❤️</p>
      <div className="screen" style={{ textAlign: "left", paddingTop: 0 }}>
        <LoadingButton
          onClick={startGoogleSignIn}
          loading={signingIn || status === "loading"}
          disabled={status === "loading"}
          className="google-signin-button"
        >
          <GoogleIcon />
          {signingIn || status === "loading" ? "Opening Google sign-in…" : "Continue with Google"}
        </LoadingButton>
        {error && <div className="error" style={{ textAlign: "center", marginTop: 14 }}>{error}</div>}
        <p className="small muted" style={{ marginTop: 22, textAlign: "center" }}>
          We use your Google account to keep your identity unique across every group —
          no separate password to remember, and no risk of duplicate names.
        </p>
      </div>
    </div>
  );
}
