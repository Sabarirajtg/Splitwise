import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, getSession, money, initials, todayISO, CURRENCIES } from "../../lib/api";
import { avatarColor } from "../../lib/colors";

export default function GroupDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [user, setUser] = useState(null);
  const [group, setGroup] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [balData, setBalData] = useState(null);
  const [tab, setTab] = useState("expenses");
  const [sheet, setSheet] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace("/login"); return; }
    setUser(session);
  }, []);

  useEffect(() => {
    if (user && id) loadAll();
  }, [user, id]);

  async function loadAll() {
    await api.processRecurring(id);
    const [g, exps, setl, bal] = await Promise.all([
      api.getGroup(id), api.groupExpenses(id), api.groupSettlements(id), api.balances(id)
    ]);
    setGroup(g); setExpenses(exps); setSettlements(setl); setBalData(bal);
  }

  if (!group) return <div className="container"><div className="screen"><p className="muted small">Loading…</p></div></div>;

  const memberName = (uid) => (group.members.find(m => m.id === uid) || {}).name || "?";

  return (
    <div className="container">
      <div className="topbar">
        <button className="btn-ghost" onClick={() => router.push("/groups")}>‹ Groups</button>
        <h1 style={{ fontSize: 16.5 }}>{group.name}</h1>
        <button className="btn-ghost" onClick={() => setSheet("invite")}>Invite</button>
      </div>
      <div className="screen">
        <div className="tabs">
          <button className={`tab ${tab === "expenses" ? "active" : ""}`} onClick={() => setTab("expenses")}>Expenses</button>
          <button className={`tab ${tab === "balances" ? "active" : ""}`} onClick={() => setTab("balances")}>Balances</button>
          <button className={`tab ${tab === "activity" ? "active" : ""}`} onClick={() => setTab("activity")}>Activity</button>
        </div>

        {tab === "expenses" && (
          expenses.length === 0
            ? <div className="empty">No expenses yet.<br />Tap + to add one.</div>
            : expenses.map(e => {
              const paidByMe = e.paidBy === user.id;
              const mySplit = (e.splits.find(s => s.userId === user.id) || { amount: 0 }).amount;
              let sub;
              if (paidByMe) sub = <span className="pill pill-teal">you lent {money(e.amount - mySplit, e.currency)}</span>;
              else if (mySplit > 0) sub = <span className="pill pill-coral">you owe {money(mySplit, e.currency)}</span>;
              else sub = <span className="pill pill-neutral">not involved</span>;
              return (
                <div key={e.id} className="card card-tap" onClick={() => { setEditingExpense(e); setSheet("expense"); }}>
                  <div className="row">
                    <div>
                      <h3 style={{ fontSize: 14.5 }}>{e.desc}</h3>
                      <p className="small muted" style={{ marginTop: 3 }}>
                        {e.date} · paid by {memberName(e.paidBy)}{e.recurring ? ` · repeats ${e.recurring}` : ""}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{money(e.amount, e.currency)}</div>
                      {e.currency !== group.baseCurrency && e.amountInBase != null && (
                        <div className="small muted">≈ {money(e.amountInBase, group.baseCurrency)}</div>
                      )}
                      <div style={{ marginTop: 4 }}>{sub}</div>
                    </div>
                  </div>
                </div>
              );
            })
        )}

        {tab === "balances" && balData && (
          <BalancesTab
            group={group} balData={balData} user={user} memberName={memberName}
            onSettle={async (from, to, amount) => {
              await api.recordSettlement(id, { from, to, amount, currency: group.baseCurrency });
              await loadAll();
            }}
          />
        )}

        {tab === "activity" && (
          <ActivityTab expenses={expenses} settlements={settlements} memberName={memberName} />
        )}
      </div>

      <button className="fab" onClick={() => { setEditingExpense(null); setSheet("expense"); }}>+</button>

      {sheet === "invite" && <InviteSheet group={group} onClose={() => setSheet(null)} />}
      {sheet === "expense" && (
        <ExpenseSheet
          group={group} user={user} editing={editingExpense}
          onClose={() => { setSheet(null); setEditingExpense(null); }}
          onSaved={async () => { setSheet(null); setEditingExpense(null); await loadAll(); }}
          onDeleted={async () => { setSheet(null); setEditingExpense(null); await loadAll(); }}
        />
      )}
    </div>
  );
}

function BalancesTab({ group, balData, user, memberName, onSettle }) {
  const { balances, simplified, baseCurrency } = balData;
  return (
    <>
      <div className="card">
        <h3 style={{ fontSize: 14.5, marginBottom: 12 }}>Simplified settle-up</h3>
        {simplified.length === 0
          ? <p className="muted small">Everyone is settled up 🎉</p>
          : simplified.map((t, i) => (
            <div className="split-row" key={i}>
              <div className="avatar" style={{ background: avatarColor(t.from) }}>{initials(memberName(t.from))}</div>
              <div style={{ flex: 1, fontSize: 13.5 }}>
                <b>{memberName(t.from)}</b> owes <b>{memberName(t.to)}</b>
              </div>
              <div style={{ fontWeight: 700 }}>{money(t.amount, baseCurrency)}</div>
              {(t.from === user.id || t.to === user.id) && (
                <button className="btn-ghost" onClick={() => onSettle(t.from, t.to, t.amount)}>Settle</button>
              )}
            </div>
          ))}
      </div>
      <div className="card">
        <h3 style={{ fontSize: 14.5, marginBottom: 12 }}>Individual balances</h3>
        {group.members.map(m => {
          const b = Math.round((balances[m.id] || 0) * 100) / 100;
          let pill = Math.abs(b) < 0.01
            ? <span className="pill pill-neutral">settled</span>
            : b > 0 ? <span className="pill pill-teal">+{money(b, baseCurrency)}</span>
              : <span className="pill pill-coral">{money(b, baseCurrency)}</span>;
          return (
            <div className="split-row" key={m.id}>
              <div className="avatar" style={{ background: avatarColor(m.id) }}>{initials(m.name)}</div>
              <div style={{ flex: 1, fontSize: 13.5 }}>{m.name}</div>
              {pill}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ActivityTab({ expenses, settlements, memberName }) {
  const items = [
    ...expenses.map(e => ({ type: "expense", date: e.date, e })),
    ...settlements.map(s => ({ type: "settle", date: s.date, s }))
  ].sort((a, b) => b.date.localeCompare(a.date));
  if (items.length === 0) return <div className="empty">No activity yet.</div>;
  return (
    <div className="card">
      {items.map((it, i) => it.type === "expense" ? (
        <div className="split-row" key={i}>
          <span style={{ width: 22 }}>🧾</span>
          <div style={{ flex: 1, fontSize: 13.5 }}>{memberName(it.e.paidBy)} added <b>{it.e.desc}</b></div>
          <div className="small muted">{it.date}</div>
        </div>
      ) : (
        <div className="split-row" key={i}>
          <span style={{ width: 22 }}>✅</span>
          <div style={{ flex: 1, fontSize: 13.5 }}>{memberName(it.s.from)} paid {memberName(it.s.to)} {money(it.s.amount, it.s.currency)}</div>
          <div className="small muted">{it.date}</div>
        </div>
      ))}
    </div>
  );
}

function InviteSheet({ group, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-handle" />
        <h3 style={{ marginBottom: 12 }}>Invite to {group.name}</h3>
        <p className="muted small" style={{ marginBottom: 10 }}>Share this group code. They can join from "Join group" after logging in.</p>
        <div className="card" style={{ textAlign: "center", fontFamily: "monospace", fontSize: 15, wordBreak: "break-all" }}>{group.id}</div>
        <button style={{ width: "100%", marginTop: 12 }} onClick={() => { navigator.clipboard?.writeText(group.id); setCopied(true); }}>
          {copied ? "Copied!" : "Copy code"}
        </button>
        <button className="linkbtn" onClick={onClose} style={{ display: "block", margin: "18px auto 0" }}>Close</button>
      </div>
    </div>
  );
}

function ExpenseSheet({ group, user, editing, onClose, onSaved, onDeleted }) {
  const members = group.members;
  const [desc, setDesc] = useState(editing ? editing.desc : "");
  const [amount, setAmount] = useState(editing ? editing.amount : "");
  const [currency, setCurrency] = useState(editing ? editing.currency : group.baseCurrency);
  const [paidBy, setPaidBy] = useState(editing ? editing.paidBy : user.id);
  const [date, setDate] = useState(editing ? editing.date : todayISO());
  const [recurring, setRecurring] = useState(editing ? (editing.recurring || "") : "");
  const [splitMethod, setSplitMethod] = useState(editing ? editing.splitMethod : "equal");
  const [includedIds, setIncludedIds] = useState(editing ? editing.splits.map(s => s.userId) : members.map(m => m.id));
  const [splitValues, setSplitValues] = useState(() => {
    const v = {};
    if (editing) editing.splits.forEach(s => { v[s.userId] = s.rawValue !== undefined && s.rawValue !== null ? s.rawValue : s.amount; });
    return v;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fxPreview, setFxPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadFx() {
      if (currency === group.baseCurrency || !amount) { setFxPreview(null); return; }
      try {
        const { rates } = await api.fx(currency);
        const rate = rates[group.baseCurrency];
        if (rate && !cancelled) setFxPreview(Math.round(parseFloat(amount) * rate * 100) / 100);
      } catch { if (!cancelled) setFxPreview(null); }
    }
    loadFx();
    return () => { cancelled = true; };
  }, [currency, amount, group.baseCurrency]);

  function toggleMember(uid) {
    setIncludedIds(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  }

  function computeSplits() {
    const amt = parseFloat(amount);
    if (splitMethod === "equal") {
      let running = 0;
      return includedIds.map((uid, i) => {
        if (i < includedIds.length - 1) {
          const v = Math.round((amt / includedIds.length) * 100) / 100;
          running += v;
          return { userId: uid, amount: v };
        }
        return { userId: uid, amount: Math.round((amt - running) * 100) / 100 };
      });
    }
    if (splitMethod === "percent") {
      const totalPct = includedIds.reduce((s, uid) => s + (parseFloat(splitValues[uid]) || 0), 0);
      if (Math.abs(totalPct - 100) > 0.5) throw new Error(`Percentages must add up to 100 (currently ${totalPct})`);
      return includedIds.map(uid => ({ userId: uid, amount: Math.round((amt * (parseFloat(splitValues[uid]) || 0) / 100) * 100) / 100, rawValue: splitValues[uid] }));
    }
    if (splitMethod === "shares") {
      const totalShares = includedIds.reduce((s, uid) => s + (parseFloat(splitValues[uid]) || 0), 0);
      if (totalShares <= 0) throw new Error("Enter shares for at least one person");
      return includedIds.map(uid => ({ userId: uid, amount: Math.round((amt * (parseFloat(splitValues[uid]) || 0) / totalShares) * 100) / 100, rawValue: splitValues[uid] }));
    }
    if (splitMethod === "exact") {
      const totalExact = includedIds.reduce((s, uid) => s + (parseFloat(splitValues[uid]) || 0), 0);
      if (Math.abs(totalExact - amt) > 0.02) throw new Error(`Exact amounts must add up to ${money(amt, currency)} (currently ${money(totalExact, currency)})`);
      return includedIds.map(uid => ({ userId: uid, amount: Math.round((parseFloat(splitValues[uid]) || 0) * 100) / 100, rawValue: splitValues[uid] }));
    }
  }

  async function save() {
    setError("");
    if (!desc.trim()) { setError("Enter a description"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError("Enter a valid amount"); return; }
    if (includedIds.length === 0) { setError("Select at least one person to split with"); return; }
    let splits;
    try { splits = computeSplits(); } catch (e) { setError(e.message); return; }

    setBusy(true);
    try {
      const payload = { desc: desc.trim(), amount: Math.round(amt * 100) / 100, currency, paidBy, date, recurring: recurring || null, splitMethod, splits };
      if (editing) await api.updateExpense(editing.id, payload);
      else await api.addExpense(group.id, payload);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function del() {
    setBusy(true);
    try { await api.deleteExpense(editing.id); onDeleted(); }
    finally { setBusy(false); }
  }

  const amt = parseFloat(amount) || 0;

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-handle" />
        <h3 style={{ marginBottom: 14 }}>{editing ? "Edit expense" : "Add expense"}</h3>
        <div className="field">
          <label>Description</label>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Dinner at Cafe" />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div className="field" style={{ flex: 2 }}>
            <label>Amount</label>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {fxPreview != null && (
          <p className="small muted" style={{ marginTop: -8, marginBottom: 14 }}>
            ≈ {money(fxPreview, group.baseCurrency)} at today's rate (group's currency is {group.baseCurrency})
          </p>
        )}
        <div className="field">
          <label>Paid by</label>
          <select value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Repeat</label>
          <select value={recurring} onChange={e => setRecurring(e.target.value)}>
            <option value="">Does not repeat</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div className="field">
          <label>Split method</label>
          <div className="chiprow">
            {["equal", "percent", "shares", "exact"].map(m => (
              <button key={m} type="button" className={`chip ${splitMethod === m ? "selected" : ""}`} onClick={() => setSplitMethod(m)}>{m}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Split between</label>
          {members.map(m => {
            const included = includedIds.includes(m.id);
            return (
              <div className="split-row" key={m.id}>
                <input type="checkbox" checked={included} onChange={() => toggleMember(m.id)} style={{ width: "auto" }} />
                <div className="avatar" style={{ background: avatarColor(m.id) }}>{initials(m.name)}</div>
                <div style={{ flex: 1, fontSize: 13.5 }}>{m.name}</div>
                {splitMethod === "equal" && (
                  <span className="small muted" style={{ width: 74, textAlign: "right" }}>
                    {included && includedIds.length > 0 ? money(amt / includedIds.length, currency) : ""}
                  </span>
                )}
                {splitMethod !== "equal" && (
                  <input
                    type="number" step="0.01" disabled={!included}
                    style={{ width: 84 }}
                    placeholder={splitMethod === "percent" ? "%" : splitMethod === "shares" ? "shares" : "amt"}
                    value={splitValues[m.id] || ""}
                    onChange={e => setSplitValues(prev => ({ ...prev, [m.id]: e.target.value }))}
                  />
                )}
              </div>
            );
          })}
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" onClick={save} disabled={busy} style={{ marginTop: 8 }}>
          {editing ? "Save changes" : "Add expense"}
        </button>
        {editing && (
          <button className="btn-danger-text" onClick={del} disabled={busy} style={{ width: "100%", marginTop: 10, background: "transparent", border: "none" }}>
            Delete expense
          </button>
        )}
        <button className="linkbtn" onClick={onClose} style={{ display: "block", margin: "16px auto 0" }}>Cancel</button>
      </div>
    </div>
  );
}
