import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, getSession, money, initials, todayISO, CURRENCIES } from "../../lib/api";
import { avatarColor } from "../../lib/colors";
import CurrencySelect from "../../components/CurrencySelect";
import { showToast } from "../../lib/toast";
import { expenseIcon, summarizeExpenses } from "../../lib/expense";

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
  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [invite, setInvite] = useState(null);

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace("/login"); return; }
    setUser(session);
  }, []);

  useEffect(() => {
    if (user && id) loadAll();
  }, [user, id]);

  async function loadAll() {
    try { await api.processRecurring(id); } catch (e) { showToast(e.message || "Could not process recurring expenses", "error"); }
    try {
      const [g, exps, setl, bal] = await Promise.all([api.getGroup(id), api.groupExpenses(id), api.groupSettlements(id), api.balances(id)]);
      setGroup(g); setExpenses(exps); setSettlements(setl); setBalData(bal);
      setSettings({ baseCurrency: g.baseCurrency, spendingCurrency: g.spendingCurrency || g.baseCurrency });
      if (!g.currencyConfigured) setSheet("settings");
    } catch (e) { showToast(e.message || "Could not load group data", "error"); }
  }

  async function saveSettings() {
    setSavingSettings(true);

    try {
      await api.updateGroupSettings(id, {
        userId: user.id,
        ...settings,
      });

      const updatedGroup = await api.getGroup(id);
      setGroup(updatedGroup);
      setSettings({
        baseCurrency: updatedGroup.baseCurrency,
        spendingCurrency:
          updatedGroup.spendingCurrency || updatedGroup.baseCurrency,
      });
      setSheet(null);
      await loadAll();
      showToast("Changes saved successfully!");
    } catch (error) {
      showToast(error.message || "Could not save settings", "error");
    } finally {
      setSavingSettings(false);
    }
  }

  async function updateSimplification(enabled) {
    try {
      await api.updateSimplification(id, {
        userId: user.id,
        enabled,
      });
      await loadAll();
      showToast("Simplification preference updated");
    } catch (error) {
      showToast(error.message || "Could not update preference", "error");
    }
  }

  if (!group) {
    return (
      <div className="container group-loading" aria-label="Loading group">
        <div className="topbar skeleton-topbar">
          <div className="skeleton skeleton-line skeleton-back" />
          <div className="skeleton skeleton-line skeleton-title" />
          <div className="skeleton skeleton-line skeleton-action" />
        </div>
        <div className="screen">
          <div className="skeleton-tabs">
            {Array.from({ length: 5 }, (_, index) => <div className="skeleton skeleton-tab" key={index} />)}
          </div>
          <div className="skeleton skeleton-card skeleton-expense-card">
            <div className="skeleton skeleton-avatar" />
            <div className="skeleton-expense-copy">
              <div className="skeleton skeleton-line skeleton-expense-title" />
              <div className="skeleton skeleton-line skeleton-expense-meta" />
            </div>
            <div className="skeleton-expense-amount">
              <div className="skeleton skeleton-line skeleton-amount" />
              <div className="skeleton skeleton-line skeleton-badge" />
            </div>
          </div>
          <div className="skeleton skeleton-card skeleton-expense-card">
            <div className="skeleton skeleton-avatar" />
            <div className="skeleton-expense-copy">
              <div className="skeleton skeleton-line skeleton-expense-title" />
              <div className="skeleton skeleton-line skeleton-expense-meta" />
            </div>
            <div className="skeleton-expense-amount">
              <div className="skeleton skeleton-line skeleton-amount" />
              <div className="skeleton skeleton-line skeleton-badge" />
            </div>
          </div>
          <div className="skeleton skeleton-card skeleton-expense-card">
            <div className="skeleton skeleton-avatar" />
            <div className="skeleton-expense-copy">
              <div className="skeleton skeleton-line skeleton-expense-title" />
              <div className="skeleton skeleton-line skeleton-expense-meta" />
            </div>
            <div className="skeleton-expense-amount">
              <div className="skeleton skeleton-line skeleton-amount" />
              <div className="skeleton skeleton-line skeleton-badge" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const memberName = (uid) => (group.members.find(m => m.id === uid) || {}).name || "?";

  return (
    <div className="container">
      <div className="topbar">
        <button className="btn-ghost" onClick={() => router.push("/groups")}>‹ Groups</button>
        <h1 style={{ fontSize: 16.5 }}>{group.name}</h1>
        <button className="btn-ghost" onClick={() => { setInvite(null); setSheet("invite"); }}>Invite Friends</button>
      </div>
      <div className="screen">
        <div className="tabs">
          <button className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>Overview</button>
          <button className={`tab ${tab === "expenses" ? "active" : ""}`} onClick={() => setTab("expenses")}>Expenses</button>
          <button className={`tab ${tab === "balances" ? "active" : ""}`} onClick={() => setTab("balances")}>Balances</button>
          <button className={`tab ${tab === "activity" ? "active" : ""}`} onClick={() => setTab("activity")}>Activity</button>
          <button className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Settings</button>
        </div>

        {tab === "overview" && <ExpensesOverview group={group} expenses={expenses} user={user} />}

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
                      <h3 style={{ fontSize: 14.5 }}><span aria-hidden="true" style={{ display: "inline-block", width: 26 }}>{expenseIcon(e.desc)}</span>{e.desc}</h3>
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
            group={group} expenses={expenses} balData={balData} user={user} memberName={memberName}
            onSettle={async (from, to, amount) => {
              await api.recordSettlement(id, { from, to, amount, currency: group.baseCurrency });
              await loadAll();
            }}
          />
        )}

        {tab === "settings" && settings && (
          <GroupSettings
            group={group}
            user={user}
            settings={settings}
            setSettings={setSettings}
            saving={savingSettings}
            onSave={saveSettings}
            onSimplification={updateSimplification}
          />
        )}

        {tab === "activity" && (
          <ActivityTab expenses={expenses} settlements={settlements} memberName={memberName} />
        )}
      </div>

      <button className="fab" onClick={() => { setEditingExpense(null); setSheet("expense"); }}>+</button>

      {sheet === "invite" && <InviteSheet group={group} user={user} invite={invite} setInvite={setInvite} onClose={() => setSheet(null)} />}
      {sheet === "settings" && settings && (
        <div className="overlay">
          <div className="sheet">
            <div className="sheet-handle" />
            <h3 style={{ marginBottom: 14 }}>
              Configure group currencies
            </h3>
            <p className="muted small">
              Choose the currency for group totals and new expenses.
            </p>
            <GroupSettings
              group={group}
              user={user}
              settings={settings}
              setSettings={setSettings}
              saving={savingSettings}
              onSave={saveSettings}
              onSimplification={updateSimplification}
              onCancel={() => setSheet(null)}
            />
          </div>
        </div>
      )}
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

function ExpensesOverview({ group, expenses, user }) {
  const summary = summarizeExpenses(expenses, group.members, group.baseCurrency);
  const categoryTotals = {};
  const memberTotals = {};
  const dateTotals = {};

  function expenseCategory(description) {
    const text = (description || "").toLowerCase();
    if (/food|lunch|dinner|breakfast|restaurant|cafe|coffee|snack|grocery|groceries|meal|pizza|drink/.test(text)) return "Food & drinks";
    if (/taxi|uber|ola|fuel|petrol|diesel|transport|metro|train|bus|flight|parking|toll|auto/.test(text)) return "Transport";
    if (/hotel|stay|room|airbnb|resort|hostel|accommodation/.test(text)) return "Stay";
    if (/shopping|shop|clothes|gift|souvenir|market|purchase/.test(text)) return "Shopping";
    if (/ticket|museum|tour|activity|game|movie|cinema|entry|boat|show/.test(text)) return "Activities";
    if (/bill|rent|utility|electricity|water|internet|wifi/.test(text)) return "Bills";
    return "Other";
  }

  expenses.forEach((expense) => {
    const amount = Number(expense.amountInBase ?? expense.amount) || 0;
    const category = expenseCategory(expense.desc);
    categoryTotals[category] = (categoryTotals[category] || 0) + amount;
    memberTotals[expense.paidBy] = (memberTotals[expense.paidBy] || 0) + amount;
    const date = expense.date || "Unknown date";
    dateTotals[date] = (dateTotals[date] || 0) + amount;
  });

  const categoryData = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const memberData = group.members
    .map((member) => ({ label: member.name, value: memberTotals[member.id] || 0, id: member.id }))
    .sort((a, b) => b.value - a.value);
  const dateData = Object.entries(dateTotals).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const totalGroupExpense = expenses.reduce((total, expense) => total + (Number(expense.amountInBase ?? expense.amount) || 0), 0);

  return (
    <div className="expense-overview">
      <div className="grid-summary">
        <div className="card overview-total-card">
          <p className="small muted">Total group expenses</p>
          <h2>{money(totalGroupExpense, group.baseCurrency)}</h2>
          <p className="small muted">{expenses.length} expense{expenses.length === 1 ? "" : "s"} recorded</p>
        </div>
        <div className="card">
          <p className="small muted">My share</p>
          <h2>{money(summary.totals[user.id] || 0, group.baseCurrency)}</h2>
          <p className="small muted">Based on your splits</p>
        </div>
      </div>

      <div className="card chart-card">
        <div className="chart-heading">
          <div>
            <p className="chart-eyebrow">BREAKDOWN</p>
            <h3>Expenses by type</h3>
          </div>
          <span className="chart-unit">{group.baseCurrency}</span>
        </div>
        <p className="small muted chart-description">Estimated from expense descriptions. Rename expenses clearly for more accurate grouping.</p>
        {categoryData.length === 0 ? <p className="muted small">Add expenses to see categories here.</p> : (
          <div className="bar-chart-list">
            {categoryData.map(([label, value]) => (
              <HorizontalBar key={label} label={label} value={value} max={Math.max(...categoryData.map((item) => item[1]), 1)} currency={group.baseCurrency} />
            ))}
          </div>
        )}
      </div>

      <div className="card chart-card">
        <div className="chart-heading">
          <div>
            <p className="chart-eyebrow">PEOPLE</p>
            <h3>Spend by member</h3>
          </div>
          <span className="chart-unit">{group.baseCurrency}</span>
        </div>
        <p className="small muted chart-description">Total expenses paid by each member, converted to the group currency.</p>
        {memberData.length === 0 || expenses.length === 0 ? <p className="muted small">Add expenses to compare member spending.</p> : (
          <div className="bar-chart-list">
            {memberData.map((member) => (
              <HorizontalBar key={member.id} label={member.label} value={member.value} max={Math.max(...memberData.map((item) => item.value), 1)} currency={group.baseCurrency} />
            ))}
          </div>
        )}
      </div>

      <div className="card chart-card">
        <div className="chart-heading">
          <div>
            <p className="chart-eyebrow">TIMELINE</p>
            <h3>Spending by date</h3>
          </div>
          <span className="chart-unit">LAST {Math.min(dateData.length, 14)} DATES</span>
        </div>
        <p className="small muted chart-description">Daily group expense totals. The tallest bar marks the highest-spending date.</p>
        {dateData.length === 0 ? <p className="muted small">Add expenses to see spending trends over time.</p> : (
          <div className="date-chart" role="img" aria-label="Bar chart showing group expenses by date">
            {dateData.map(([date, value]) => {
              const max = Math.max(...dateData.map((item) => item[1]), 1);
              const height = Math.max(4, (value / max) * 100);
              const isPeak = value === max;
              return (
                <div className="date-chart-column" key={date} title={`${date}: ${money(value, group.baseCurrency)}`}>
                  <span className="date-chart-value">{value === max ? money(value, group.baseCurrency) : ""}</span>
                  <div className={`date-chart-bar ${isPeak ? "peak" : ""}`} style={{ height: `${height}%` }} />
                  <span className="date-chart-label">{date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        )}
        {dateData.length > 0 && (() => {
          const peak = dateData.reduce((best, item) => item[1] > best[1] ? item : best, dateData[0]);
          return <p className="chart-peak-note">Highest spend: <strong>{peak[0]}</strong> · <strong>{money(peak[1], group.baseCurrency)}</strong></p>;
        })()}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 14.5 }}>Original-currency totals</h3>
        <p className="small muted">These amounts stay separate and are not added together across currencies.</p>
        <div className="currency-breakdown">
          {Object.entries(summary.byCurrency).map(([currency, amount]) => (
            <span className="pill pill-neutral" key={currency}>{money(amount, currency)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function HorizontalBar({ label, value, max, currency }) {
  const width = Math.max(0, (value / max) * 100);
  return (
    <div className="horizontal-chart-row">
      <div className="horizontal-chart-label" title={label}>{label}</div>
      <div className="horizontal-chart-track">
        <div className="horizontal-chart-fill" style={{ width: `${width}%` }} />
      </div>
      <strong className="horizontal-chart-value">{money(value, currency)}</strong>
    </div>
  );
}

function GroupSettings({
  group,
  user,
  settings,
  setSettings,
  saving,
  onSave,
  onSimplification,
  onCancel,
}) {
  const originalSettings = {
    baseCurrency: group.baseCurrency,
    spendingCurrency: group.spendingCurrency || group.baseCurrency,
  };

  const hasChanges =
    settings.baseCurrency !== originalSettings.baseCurrency ||
    settings.spendingCurrency !== originalSettings.spendingCurrency;
  const optedOut = (group.simplificationOptOutIds || []).includes(user.id);

  return (
    <div className="card">
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Group settings</h3>
      <CurrencySelect
        label="Base currency · group totals and balances"
        value={settings.baseCurrency}
        onChange={(value) =>
          setSettings((previous) => ({ ...previous, baseCurrency: value }))
        }
        disabled={saving}
      />
      <div style={{ height: 12 }} />
      <CurrencySelect
        label="Spending currency · default for new expenses"
        value={settings.spendingCurrency}
        onChange={(value) =>
          setSettings((previous) => ({
            ...previous,
            spendingCurrency: value,
          }))
        }
        disabled={saving}
      />

      <p className="small muted" style={{ marginTop: 10 }}>
        Changing the base currency recalculates consolidated values.
        Each expense keeps its original currency and exchange-rate snapshot.
      </p>

      {hasChanges && (
        <button
          className="btn-primary"
          disabled={saving}
          onClick={onSave}
          style={{ marginTop: 10 }}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      )}

      {onCancel && (
        <button
          className="linkbtn"
          onClick={onCancel}
          style={{ display: "block", margin: "14px auto 0" }}
        >
          Cancel
        </button>
      )}

      <div
        className="divider"
        style={{ margin: "20px 0", borderTop: "1px solid var(--border)" }}
      />
      <h3 style={{ fontSize: 14.5, marginBottom: 8 }}>
        Debt simplification
      </h3>
      <p className="small muted">
        Opting out keeps your obligations visible. It never removes
        your debt or credit from the group ledger.
      </p>
      <label className="setting-toggle">
        <input
          type="checkbox"
          checked={!optedOut}
          onChange={(event) => onSimplification(event.target.checked)}
          style={{ width: "auto" }}
        />
        Participate in suggested simplification
      </label>

      <div style={{ marginTop: 12 }}>
        {group.members.map((member) => {
          const memberOptedOut = (
            group.simplificationOptOutIds || []
          ).includes(member.id);

          return (
            <div className="split-row" key={member.id}>
              <div
                className="avatar"
                style={{ background: avatarColor(member.id) }}
              >
                {initials(member.name)}
              </div>
              <div style={{ flex: 1, fontSize: 13.5 }}>
                {member.name}
              </div>
              <span
                className={`pill ${
                  memberOptedOut ? "pill-neutral" : "pill-teal"
                }`}
              >
                {memberOptedOut ? "Opted out" : "Participating"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BalancesTab({ group, expenses, balData, user, memberName, onSettle }) {
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
        <h3 style={{ fontSize: 14.5, marginBottom: 12 }}>
          Expense currency breakdown
        </h3>
        <p className="small muted">
          Original transaction values stay separate; converted equivalents
          use the group base currency.
        </p>
        {expenses.map((expense) => (
          <div className="split-row" key={expense.id}>
            <div style={{ flex: 1, fontSize: 13 }}>
              <span aria-hidden="true" style={{ marginRight: 8 }}>
                {expenseIcon(expense.desc)}
              </span>
              <b>{expense.desc}</b>
              <div className="small muted">{expense.date}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <b>{money(expense.amount, expense.currency)}</b>
              <div className="small muted">
                ≈ {money(
                  expense.amountInBase ?? expense.amount,
                  group.baseCurrency,
                )}
              </div>
            </div>
          </div>
        ))}
        {balData.expenseBreakdown && (
          <div className="currency-breakdown">
            {Object.entries(
              balData.expenseBreakdown.currencyTotals || {},
            ).map(([currency, amount]) => (
              <span className="pill pill-neutral" key={currency}>
                {money(amount, currency)}
              </span>
            ))}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          Consolidated expense total:{" "}
          {money(
            balData.expenseBreakdown?.groupTotal || 0,
            group.baseCurrency,
          )}
        </p>
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
          <span aria-hidden="true" style={{ width: 22 }}>{expenseIcon(it.e.desc)}</span>
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

function InviteSheet({ group, user, invite, setInvite, onClose }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [revoked, setRevoked] = useState(false);

  const currentToken = revoked
    ? null
    : invite?.token || group.inviteToken;

  async function ensureInvite() {
    const result = await api.createInvite(group.id, {
      userId: user.id,
      expiresAt: expiresAt
        ? new Date(expiresAt).toISOString()
        : undefined,
    });

    setInvite(result);
    setRevoked(false);
    return result.token;
  }

  async function getShareableLink() {
    const token =
      (expiresAt ? await ensureInvite() : currentToken) ||
      (await ensureInvite());

    return `${window.location.origin}/invite/${token}`;
  }

  async function copyLink() {
    setBusy(true);

    try {
      const link = await getShareableLink();
      await navigator.clipboard.writeText(link);
      setCopied(true);
      showToast("Invite link copied successfully!");
    } catch (error) {
      showToast(error.message || "Could not copy invite link", "error");
    } finally {
      setBusy(false);
    }
  }

  async function shareLink() {
    setBusy(true);

    try {
      const url = await getShareableLink();

      if (navigator.share) {
        await navigator.share({
          title: `Join ${group.name}`,
          text: `Join my SplitShare group: ${group.name}`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        showToast("Invite link copied successfully!");
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        showToast(error.message || "Could not share invite link", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function regenerateLink() {
    setBusy(true);

    try {
      await ensureInvite();
      setCopied(false);
      showToast("Invitation link regenerated");
    } catch (error) {
      showToast(error.message || "Could not regenerate link", "error");
    } finally {
      setBusy(false);
    }
  }

  async function revokeLink() {
    setBusy(true);

    try {
      await api.revokeInvite(group.id, { userId: user.id });
      setInvite(null);
      setRevoked(true);
      setCopied(false);
      showToast("Invitation revoked");
    } catch (error) {
      showToast(error.message || "Could not revoke link", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet">
        <div className="sheet-handle" />
        <h3 style={{ marginBottom: 12 }}>
          Invite friends to {group.name}
        </h3>
        <p className="muted small">
          Anyone with this link can request to join. The invitation
          preview does not expose expenses or balances.
        </p>

        <div className="field">
          <label>Optional expiration</label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </div>

        {currentToken ? (
          <div
            className="card"
            style={{ fontSize: 13, wordBreak: "break-all" }}
          >
            {typeof window !== "undefined"
              ? `${window.location.origin}/invite/${currentToken}`
              : "Invitation link"}
          </div>
        ) : (
          <p className="muted small">
            Generate a unique link to invite friends.
          </p>
        )}

        <button
          className="btn-primary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={copyLink}
        >
          {busy
            ? "Preparing…"
            : copied
              ? "Copy invite link again"
              : "Copy invite link"}
        </button>
        <button
          className="invite-secondary-button"
          style={{ width: "100%", marginTop: 8 }}
          disabled={busy}
          onClick={shareLink}
        >
          Share link…
        </button>
        <button
          className="invite-secondary-button"
          style={{ width: "100%", marginTop: 8 }}
          disabled={busy}
          onClick={regenerateLink}
        >
          Regenerate link
        </button>
        <button
          className="btn-danger-text"
          style={{ width: "100%", marginTop: 8 }}
          disabled={busy || !currentToken}
          onClick={revokeLink}
        >
          Revoke link
        </button>
        <button
          className="linkbtn"
          onClick={onClose}
          style={{ display: "block", margin: "18px auto 0" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ExpenseSheet({ group, user, editing, onClose, onSaved, onDeleted }) {
  const members = group.members;
  const [desc, setDesc] = useState(editing ? editing.desc : "");
  const [amount, setAmount] = useState(editing ? editing.amount : "");
  const [currency, setCurrency] = useState(editing ? editing.currency : (group.spendingCurrency || group.baseCurrency));
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
      if (editing) { await api.updateExpense(editing.id, payload); showToast("Expense updated successfully!"); }
      else { await api.addExpense(group.id, payload); showToast("Expense added successfully!"); }
      onSaved();
    } catch (e) {
      setError(e.message); showToast(e.message || "Could not save expense", "error");
    } finally { setBusy(false); }
  }

  async function del() {
    setBusy(true);
    try { await api.deleteExpense(editing.id); showToast("Expense deleted successfully!"); onDeleted(); }
    catch(e) { showToast(e.message || "Could not delete expense", "error"); }
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
