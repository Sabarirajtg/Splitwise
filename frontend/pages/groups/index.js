import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, getSession, clearSession, money, CURRENCIES } from "../../lib/api";
import { signOut } from "next-auth/react";
import CurrencySelect from "../../components/CurrencySelect";
import { showToast } from "../../lib/toast";

export default function Groups() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [groups, setGroups] = useState(null);
  const [balances, setBalances] = useState({});
  const [sheet, setSheet] = useState(null);
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState("INR");
  const [newSpendingCurrency, setNewSpendingCurrency] = useState("INR");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState({});
  const [busy, setBusy] = useState(false);
  const [pendingSettlements, setPendingSettlements] = useState([]);
  const [profile, setProfile] = useState(null);
  const [upiDraft, setUpiDraft] = useState("");
  const [upiEditorOpen, setUpiEditorOpen] = useState(false);
  const [savingUpi, setSavingUpi] = useState(false);
  const [upiSetupDismissed, setUpiSetupDismissed] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace("/login"); return; }
    setUser(session);
    setUpiSetupDismissed(localStorage.getItem("splitshare_upi_setup_dismissed_" + session.id) === "1");
    loadGroups(session.id);
    api.getUser(session.id).then((currentUser) => {
      setProfile(currentUser);
      setUpiDraft(currentUser.upiId || "");
    }).catch(() => setProfile(null));
  }, []);

  async function loadGroups(userId) {
    try {
    const list = await api.userGroups(userId);
    setGroups(list);
    const balMap = {};
    for (const g of list) {
      try {
        const b = await api.balances(g.id);
        balMap[g.id] = b.balances[userId] || 0;
      } catch { balMap[g.id] = 0; }
    }
    setBalances(balMap);
    try {
      const pending = await api.pendingSettlements(userId);
      setPendingSettlements(Array.isArray(pending) ? pending : []);
    } catch {
      setPendingSettlements([]);
    }
    } catch (e) { setGroups([]); showToast(e.message || "Could not load groups", "error"); }
  }

  function dismissUpiSetup() {
    localStorage.setItem("splitshare_upi_setup_dismissed_" + user.id, "1");
    setUpiSetupDismissed(true);
    setUpiEditorOpen(false);
  }

  async function saveUpi() {
    setSavingUpi(true);
    try {
      const updated = await api.updateUpi(user.id, upiDraft.trim());
      setProfile((previous) => ({ ...(previous || {}), ...updated }));
      setUpiEditorOpen(false);
      dismissUpiSetup();
      showToast("UPI ID saved");
    } catch (e) {
      showToast(e.message || "Could not save UPI ID", "error");
    } finally {
      setSavingUpi(false);
    }
  }

  async function createGroup() {
    setError({});
    if (!newName.trim()) { setError({ group: "Enter a group name" }); return; }
    setBusy(true);
    try {
      const g = await api.createGroup(newName, newCurrency, user.id, newSpendingCurrency);
      setSheet(null); setNewName("");
      showToast("Group created successfully!");
      router.push(`/groups/${g.id}`);
    } catch (e) {
      setError({ group: e.message }); showToast(e.message || "Could not create group", "error");
    } finally { setBusy(false); }
  }

  async function joinGroup() {
    setError({});
    if (!joinCode.trim()) { setError({ join: "Enter a group code" }); return; }
    setBusy(true);
    try {
      const g = await api.joinGroup(joinCode.trim(), user.id);
      setSheet(null); setJoinCode("");
      router.push(`/groups/${g.id}`);
    } catch (e) {
      setError({ join: e.message }); showToast(e.message || "Could not join group", "error");
    } finally { setBusy(false); }
  }

  function logout() {
    clearSession();
    signOut({ redirect: false }).then(() => router.push("/login"));
  }

  return (
    <div className="container">
      <div className="topbar">
        <h1><span className="brand-gradient-text">Your groups</span></h1>
        <button className="btn-ghost" onClick={logout}>Log out</button>
      </div>
      <div className="screen">
        {pendingSettlements.length > 0 && (
          <section className="needs-attention" aria-label="Needs attention">
            <div className="needs-attention-heading">
              <div>
                <h2>Needs attention</h2>
                <p className="small muted">Payment updates waiting for you</p>
              </div>
              <span className="attention-count">{pendingSettlements.length}</span>
            </div>
            {pendingSettlements.slice(0, 3).map((item) => {
              const isRecipient = item.to === user.id;
              const message = item.status === "reported_problem"
                ? (isRecipient ? "You reported a payment issue." : item.toName + " reported a payment issue.")
                : item.fromName + " marked a payment as paid.";
              return (
                <button className="needs-attention-item" key={item.id} onClick={() => router.push("/groups/" + item.groupId)}>
                  <span className="attention-item-icon" aria-hidden="true">↗</span>
                  <span className="attention-item-copy">
                    <strong>{money(item.amount, item.currency)}</strong>
                    <span>{message}</span>
                    <span className="small muted">{item.groupName}</span>
                  </span>
                  <span className="attention-item-action">Review</span>
                </button>
              );
            })}
            {pendingSettlements.length > 3 && <p className="small muted">And {pendingSettlements.length - 3} more payment update(s).</p>}
          </section>
        )}

        {profile && !profile.upiId && !upiSetupDismissed && (
          <section className="upi-setup-card">
            <div className="upi-setup-icon" aria-hidden="true">₹</div>
            <div className="upi-setup-content">
              <h3>Make receiving payments easier</h3>
              <p className="small muted">Add your UPI ID once so group members can pay you more easily. You can skip this for now.</p>
              {upiEditorOpen ? (
                <>
                  <label htmlFor="splitshare-upi-id">Your UPI ID</label>
                  <input id="splitshare-upi-id" value={upiDraft} onChange={(event) => setUpiDraft(event.target.value)} placeholder="name@bank" autoComplete="off" />
                  <div className="upi-setup-actions">
                    <button className="btn-primary" onClick={saveUpi} disabled={savingUpi || !upiDraft.trim()}>{savingUpi ? "Saving…" : "Save UPI ID"}</button>
                    <button className="linkbtn" onClick={dismissUpiSetup} disabled={savingUpi}>Not now</button>
                  </div>
                </>
              ) : (
                <div className="upi-setup-actions">
                  <button className="btn-primary" onClick={() => setUpiEditorOpen(true)}>Set up once</button>
                  <button className="linkbtn" onClick={dismissUpiSetup}>Not now</button>
                </div>
              )}
            </div>
          </section>
        )}

        {groups === null && <div className="groups-loading" aria-label="Loading groups">{[0, 1, 2].map((item) => <div className="card skeleton-group-card" key={item}><div className="skeleton skeleton-line skeleton-group-title" /><div className="skeleton skeleton-line skeleton-group-meta" /><div className="skeleton skeleton-line skeleton-group-badge" /></div>)}</div>}
        {groups && groups.length === 0 && (
          <div className="empty">No groups yet.<br />Create one or join with a group code.</div>
        )}
        {groups && groups.map(g => {
          const mine = Math.round((balances[g.id] || 0) * 100) / 100;
          let pill;
          if (Math.abs(mine) < 0.01) pill = <span className="pill pill-neutral">settled up</span>;
          else if (mine > 0) pill = <span className="pill pill-teal">you're owed {money(mine, g.baseCurrency)}</span>;
          else pill = <span className="pill pill-coral">you owe {money(-mine, g.baseCurrency)}</span>;
          return (
            <div key={g.id} className="card card-tap" onClick={() => router.push(`/groups/${g.id}`)}>
              <div className="row">
                <div>
                  <h3 style={{ fontSize: 15.5 }}>{g.name}</h3>
                  <p className="small muted" style={{ marginTop: 3 }}>{g.memberIds.length} member{g.memberIds.length !== 1 ? "s" : ""} · {g.baseCurrency}</p>
                </div>
                {pill}
              </div>
            </div>
          );
        })}
      </div>

      <button className="fab" onClick={() => setSheet("new")}>+</button>

      {sheet === "new" && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setSheet(null)}>
          <div className="sheet">
            <div className="sheet-handle" />
            <h3 style={{ marginBottom: 16 }}>New group</h3>
            <div className="field">
              <label>Group name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Flatmates" />
            </div>
            <div className="field"><CurrencySelect label="Base currency · group totals" value={newCurrency} onChange={setNewCurrency} /></div>
            <div className="field"><CurrencySelect label="Spending currency · default expenses" value={newSpendingCurrency} onChange={setNewSpendingCurrency} /></div>
            {error.group && <div className="error">{error.group}</div>}
            <button className="btn-primary" onClick={createGroup} disabled={busy}>Create group</button>
            <div style={{ textAlign: "center", margin: "18px 0 10px", color: "var(--text-3)", fontSize: 12.5 }}>or</div>
            <div className="field">
              <label>Join with group code</label>
              <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Paste group code" />
            </div>
            {error.join && <div className="error">{error.join}</div>}
            <button onClick={joinGroup} disabled={busy} style={{ width: "100%" }}>Join group</button>
            <button className="linkbtn" onClick={() => setSheet(null)} style={{ display: "block", margin: "18px auto 0" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
