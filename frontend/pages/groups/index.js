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

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace("/login"); return; }
    setUser(session);
    loadGroups(session.id);
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
    } catch (e) { setGroups([]); showToast(e.message || "Could not load groups", "error"); }
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
