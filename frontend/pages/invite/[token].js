import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, getSession } from "../../lib/api";
import { showToast } from "../../lib/toast";

export default function InviteLanding() {
  const router = useRouter();
  const { token } = router.query;

  const [invitation, setInvitation] = useState(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!router.isReady || !token) return;

    let isMounted = true;

    api
      .getInvite(token)
      .then((result) => {
        if (isMounted) setInvitation(result);
      })
      .catch((requestError) => {
        if (isMounted) {
          setError(
            requestError.message || "This invitation is invalid or expired",
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, [router.isReady, token]);

  async function joinGroup() {
    const user = getSession();

    if (!user) {
      const next = encodeURIComponent(router.asPath);
      router.push(`/login?next=${next}`);
      return;
    }

    setJoining(true);

    try {
      const group = await api.joinInvite(token, user.id);
      showToast("You joined the group successfully!");
      router.replace(`/groups/${group.id}`);
    } catch (requestError) {
      const message = requestError.message || "Could not join group";
      setError(message);
      showToast(message, "error");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="container">
      <div className="screen" style={{ paddingTop: 80 }}>
        <div className="card" style={{ textAlign: "center", padding: 28 }}>
          <div className="logo-hero">🔗</div>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>
            Group invitation
          </h1>

          {error ? (
            <p className="error">{error}</p>
          ) : !invitation ? (
            <>
              <div className="skeleton skeleton-card" />
              <p className="muted small">Checking invitation…</p>
            </>
          ) : (
            <>
              <p className="muted">You’ve been invited to join</p>
              <h2 style={{ margin: "8px 0 20px" }}>
                {invitation.groupName}
              </h2>
              <button
                className="btn-primary"
                onClick={joinGroup}
                disabled={joining}
              >
                {joining ? "Joining…" : "Join group"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
