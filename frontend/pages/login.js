import { useState } from "react";
import { useRouter } from "next/router";
import { api, setSession } from "../lib/api";

export default function Login() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const user = await api.login(name, pin);
      setSession(user);
      router.push("/groups");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ paddingTop: 90, textAlign: "center" }}>
      <div className="logo-hero">💸</div>
      <h1 style={{ fontSize: 26 }}>
        <span className="brand-gradient-text">SplitShare</span>
      </h1>
      <p className="muted" style={{ marginBottom: 10 }}>Split expenses with your group, in any currency</p>
      <p style={{ marginBottom: 36 }} className="brand-gradient-text muted">by Sabsh ❤️</p>
      <div className="screen" style={{ textAlign: "left", paddingTop: 0 }}>
        <div className="field">
          <label>Your name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sabarysh" />
        </div>
        <div className="field">
          <label>PIN (4+ digits)</label>
          <input
            value={pin}
            onChange={e => setPin(e.target.value)}
            type="password"
            inputMode="numeric"
            placeholder="Choose or enter your PIN"
            onKeyDown={e => e.key === "Enter" && submit()}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" onClick={submit} disabled={loading} style={{ marginTop: 8 }}>
          {loading ? "Please wait…" : "Continue"}
        </button>
        <p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>
          First time? Enter a name and PIN to create your identity. Use the same name + PIN next time to log back in.
        </p>
      </div>
    </div>
  );
}
