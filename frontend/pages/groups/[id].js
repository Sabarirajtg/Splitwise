import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { api, getSession, money, initials, todayISO, CURRENCIES } from "../../lib/api";
import { avatarColor } from "../../lib/colors";
import CurrencySelect from "../../components/CurrencySelect";
import { showToast } from "../../lib/toast";
import { expenseIcon, summarizeExpenses } from "../../lib/expense";
import LoadingButton from "../../components/LoadingButton";

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
  const [savingSimplification, setSavingSimplification] = useState(false);
  const [settlementAction, setSettlementAction] = useState(null);
  const [invite, setInvite] = useState(null);
  const [settleDraft, setSettleDraft] = useState(null);
  const [upiEditorOpen, setUpiEditorOpen] = useState(false);
  const [upiDraft, setUpiDraft] = useState("");
  const [savingUpi, setSavingUpi] = useState(false);
  const [upiPromptDismissed, setUpiPromptDismissed] = useState(false);
  const refreshPromiseRef = useRef(null);

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace("/login"); return; }
    setUser(session);
  }, []);

  useEffect(() => {
    if (user && id) loadAll();
  }, [user, id]);

  // Refresh the entire group view while it is open so changes made by other
  // members appear automatically without a manual page refresh. Pause polling
  // when the tab is hidden, then refresh immediately on focus/visibility restore.
  useEffect(() => {
    if (!user || !id) return undefined;
    let active = true;

    async function refreshVisibleGroup() {
      if (!active || document.visibilityState !== "visible") return;
      await refreshGroupData();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") refreshVisibleGroup();
    }

    window.addEventListener("focus", refreshVisibleGroup);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const intervalId = window.setInterval(refreshVisibleGroup, 15000);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshVisibleGroup);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [user, id]);

  async function refreshGroupData({ showError = false } = {}) {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const refreshPromise = (async () => {
      try {
        const [g, exps, setl, bal] = await Promise.all([
          api.getGroup(id),
          api.groupExpenses(id),
          api.groupSettlements(id),
          api.balances(id)
        ]);
        setGroup(g);
        setExpenses(Array.isArray(exps) ? exps : []);
        setSettlements(Array.isArray(setl) ? setl : []);
        setBalData(bal);
        return g;
      } catch (error) {
        if (showError) showToast(error.message || "Could not load group data", "error");
        return null;
      }
    })();

    refreshPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (refreshPromiseRef.current === refreshPromise) refreshPromiseRef.current = null;
    }
  }

  async function loadAll() {
    try {
      await api.processRecurring(id);
    } catch (error) {
      showToast(error.message || "Could not process recurring expenses", "error");
    }

    const g = await refreshGroupData({ showError: true });
    if (g) {
      setSettings({
        baseCurrency: g.baseCurrency,
        spendingCurrency: g.spendingCurrency || g.baseCurrency
      });
      if (!g.currencyConfigured) setSheet("settings");
    }
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
    if (savingSimplification) return;
    setSavingSimplification(true);
    try {
      await api.updateSimplification(id, {
        userId: user.id,
        enabled,
      });
      await loadAll();
      showToast("Simplification preference updated");
    } catch (error) {
      showToast(error.message || "Could not update preference", "error");
    } finally {
      setSavingSimplification(false);
    }
  }

  function startSettlement(from, to, amount) {
    setSettleDraft({ from, to, amount, currency: group.baseCurrency });
    setSheet("settle");
  }

  function reviewSettlement(settlement) {
    setSettleDraft({
      from: settlement.from,
      to: settlement.to,
      amount: settlement.amount,
      currency: settlement.currency || group.baseCurrency,
      existingSettlementId: settlement.id
    });
    setSheet("settle");
  }

  async function markSettlementPaid() {
    if (!settleDraft || !user || settlementAction) return;
    const isRetry = Boolean(settleDraft.existingSettlementId);
    setSettlementAction("mark-paid");
    try {
      await api.recordSettlement(id, { ...settleDraft, userId: user.id, date: settleDraft.date || todayISO() });
      setSheet(null);
      setSettleDraft(null);
      await loadAll();
      showToast(isRetry
        ? "Payment marked paid again. Waiting for the recipient to confirm."
        : "Marked as paid. Waiting for the recipient to confirm.");
    } catch (error) {
      showToast(error.message || "Could not record payment", "error");
    } finally {
      setSettlementAction(null);
    }
  }

  async function confirmSettlement(settlementId) {
    if (settlementAction) return;
    setSettlementAction(`${settlementId}:confirm`);
    try {
      await api.confirmSettlement(id, settlementId, user.id);
      await loadAll();
      showToast("Payment confirmed and balance updated");
    } catch (error) {
      showToast(error.message || "Could not confirm payment", "error");
    } finally {
      setSettlementAction(null);
    }
  }

  async function reportSettlementProblem(settlementId) {
    if (settlementAction) return;
    setSettlementAction(`${settlementId}:report`);
    try {
      await api.reportSettlementProblem(id, settlementId, user.id, "Recipient has not received the payment");
      await loadAll();
      showToast("Issue reported to the payer");
    } catch (error) {
      showToast(error.message || "Could not report payment issue", "error");
    } finally {
      setSettlementAction(null);
    }
  }

  async function saveUpiId() {
    if (!user || !upiDraft.trim()) return;
    setSavingUpi(true);
    try {
      const updated = await api.updateUpi(user.id, upiDraft.trim());
      setGroup((previous) => previous ? {
        ...previous,
        members: previous.members.map((member) =>
          member.id === user.id ? { ...member, upiId: updated.upiId || null } : member
        ),
      } : previous);
      setUpiDraft(updated.upiId || "");
      setUpiEditorOpen(false);
      setUpiPromptDismissed(false);
      showToast("UPI ID saved");
    } catch (error) {
      showToast(error.message || "Could not save UPI ID", "error");
    } finally {
      setSavingUpi(false);
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

  const memberName = (uid) => {
    if (uid === user.id) return "You";
    return (group.members.find((member) => member.id === uid) || {}).name || "?";
  };
  const groupPendingSettlements = settlements.filter((settlement) => settlement.status !== "settled" && (settlement.from === user.id || settlement.to === user.id));

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

        {group.members.some((member) => member.id === user.id && !member.upiId) && upiPromptDismissed && (
          <p className="upi-later-prompt small muted">
            Want to receive payments through UPI?{" "}
            <button
              className="linkbtn"
              onClick={() => {
                setUpiDraft("");
                setUpiPromptDismissed(false);
                setUpiEditorOpen(true);
              }}
            >
              Set up UPI
            </button>
          </p>
        )}

        {group.members.some((member) => member.id === user.id && !member.upiId) && !upiPromptDismissed && (
          <section className="upi-setup-card" aria-label="UPI setup">
            <div className="upi-setup-icon" aria-hidden="true">₹</div>
            <div className="upi-setup-content">
              <h3>{upiEditorOpen ? "Add your UPI ID" : "Want to receive payments through UPI?"}</h3>
              <p className="small muted">Add your UPI ID so group members can pay you more easily when settling balances. You can skip this for now.</p>
              {upiEditorOpen ? (
                <>
                  <label htmlFor="splitshare-upi-id">Your UPI ID</label>
                  <input
                    id="splitshare-upi-id"
                    value={upiDraft}
                    onChange={(event) => setUpiDraft(event.target.value)}
                    placeholder="name@bank"
                    autoComplete="off"
                  />
                  <div className="upi-setup-actions">
                    <LoadingButton className="btn-primary" onClick={saveUpiId} loading={savingUpi} disabled={!upiDraft.trim()}>
                      {savingUpi ? "Saving…" : "Save UPI ID"}
                    </LoadingButton>
                    <button className="linkbtn" onClick={() => setUpiEditorOpen(false)} disabled={savingUpi}>Cancel</button>
                  </div>
                </>
              ) : (
                <div className="upi-setup-actions">
                  <button className="btn-primary" onClick={() => { setUpiDraft(""); setUpiEditorOpen(true); }}>Set up UPI</button>
                  <button className="linkbtn" onClick={() => setUpiPromptDismissed(true)}>Not now</button>
                </div>
              )}
            </div>
          </section>
        )}

        {groupPendingSettlements.length > 0 && (
          <PendingSettlementPanel settlements={groupPendingSettlements} user={user} memberName={memberName} currency={group.baseCurrency} onConfirm={confirmSettlement} onReportProblem={reportSettlementProblem} onReview={reviewSettlement} loadingAction={settlementAction} />
        )}

        {tab === "overview" && <ExpensesOverview group={group} expenses={expenses} user={user} />}

        {tab === "expenses" && (
          expenses.length === 0
            ? <div className="empty">No expenses yet.<br />Tap + to add one.</div>
            : [...expenses].sort((a, b) =>
                getRecordTimestamp(b.createdAt, b.date) - getRecordTimestamp(a.createdAt, a.date)
              ).map(e => {
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
            group={group} expenses={expenses} settlements={settlements} balData={balData} user={user} memberName={memberName}
            onSettle={startSettlement}
            onReview={reviewSettlement}
          />
        )}

        {tab === "settings" && settings && (
          <GroupSettings
            group={group}
            user={user}
            settings={settings}
            setSettings={setSettings}
            saving={savingSettings}
            savingSimplification={savingSimplification}
            onSave={saveSettings}
            onSimplification={updateSimplification}
          />
        )}

        {tab === "activity" && (
          <ActivityTab expenses={expenses} settlements={settlements} memberName={memberName} user={user} />
        )}
      </div>

      <button className="fab" onClick={() => { setEditingExpense(null); setSheet("expense"); }}>+</button>

      {sheet === "settle" && settleDraft && <PaymentSheet group={group} draft={settleDraft} onMarkPaid={markSettlementPaid} onClose={() => { setSheet(null); setSettleDraft(null); }} loading={settlementAction === "mark-paid"} disabled={Boolean(settlementAction)} />}
      {sheet === "invite" && <InviteSheet group={group} user={user} invite={invite} setInvite={setInvite} onClose={() => setSheet(null)} />}
      {sheet === "settings" && settings && (
        <div className="overlay">
          <div className="sheet">
            <button type="button" className="sheet-close-button" aria-label="Close group settings" onClick={() => setSheet(null)} disabled={savingSettings || savingSimplification}>×</button>
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
              savingSimplification={savingSimplification}
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

function PendingSettlementPanel({ settlements, user, memberName, currency, onConfirm, onReportProblem, onReview, loadingAction }) {
  return (
    <section className="pending-payments" aria-label="Payments needing attention">
      <div className="pending-payments-heading"><span className="attention-count">{settlements.length}</span><div><h3>Payment updates</h3><p className="small muted">These payments are not settled yet.</p></div></div>
      {settlements.map((settlement) => {
        const isRecipient = settlement.to === user.id;
        const isProblem = settlement.status === "reported_problem";
        return (
          <div className="pending-payment-item" key={settlement.id}>
            <div className="pending-payment-copy">
              <strong>{money(settlement.amount, currency)}</strong>
              <p className="small">{isProblem ? (isRecipient ? "You reported a problem with this payment." : memberName(settlement.to) + " reported a problem with this payment.") : (isRecipient ? memberName(settlement.from) + " marked this as paid." : "Waiting for " + memberName(settlement.to) + " to confirm.")}</p>
              {isProblem && settlement.issueNote && <p className="small muted">{settlement.issueNote}</p>}
            </div>
            {isRecipient && <div className="pending-payment-actions">
              <LoadingButton className="btn-primary pending-confirm-button" loading={loadingAction === `${settlement.id}:confirm`} disabled={Boolean(loadingAction)} onClick={() => onConfirm(settlement.id)}>Received</LoadingButton>
              {!isProblem && <LoadingButton className="pending-problem-button" loading={loadingAction === `${settlement.id}:report`} disabled={Boolean(loadingAction)} onClick={() => onReportProblem(settlement.id)}>Not received</LoadingButton>}
            </div>}
            {!isRecipient && isProblem && <div className="pending-payment-actions">
              <button className="btn-primary pending-confirm-button" disabled={Boolean(loadingAction)} onClick={() => onReview(settlement)}>Review / Try again</button>
            </div>}
          </div>
        );
      })}
    </section>
  );
}

function PaymentSheet({ group, draft, onMarkPaid, onClose, loading, disabled }) {
  const recipient = group.members.find((member) => member.id === draft.to);
  const canUseUpi = draft.currency === "INR" && Boolean(recipient && recipient.upiId);
  function openUpi() {
    if (!canUseUpi) return;
    const params = new URLSearchParams({ pa: recipient.upiId, pn: recipient.name, am: Number(draft.amount).toFixed(2), cu: "INR", tn: "SplitShare settlement - " + group.name });
    window.location.href = "upi://pay?" + params.toString();
  }
  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet payment-sheet">
        <button type="button" className="sheet-close-button" aria-label="Close payment dialog" onClick={onClose} disabled={disabled}>×</button>
        <div className="sheet-handle" />
        <p className="chart-eyebrow">SETTLEMENT</p>
        <h2 style={{ marginBottom: 6 }}>{draft.existingSettlementId ? "Review payment to " : "Pay "}{recipient ? recipient.name : "group member"}</h2>
        <p className="muted small">{draft.existingSettlementId
          ? "The recipient reported that this payment was not received. Review this original amount; if you try again, resubmit this same payment for confirmation."
          : "Once you have made the transfer, mark it as paid. The recipient can confirm when they are next in SplitShare."}</p>
        <div className="payment-amount-card"><span className="small muted">Amount to pay</span><strong>{money(draft.amount, draft.currency)}</strong>{canUseUpi && <span className="small muted">UPI ID · {recipient.upiId}</span>}</div>
        {canUseUpi ? <button className="btn-primary" onClick={openUpi}>Pay with UPI</button> : <p className="payment-hint">{draft.currency !== "INR" ? "UPI links are available for INR settlements. You can still pay another way." : "This person has not added a UPI ID yet. You can still pay them another way."}</p>}
        <LoadingButton className="btn-primary payment-mark-button" loading={loading} disabled={disabled} onClick={onMarkPaid}>{loading ? "Sending payment request…" : draft.existingSettlementId ? "I’ve paid again — request confirmation" : "I’ve paid — request confirmation"}</LoadingButton>
        <p className="small muted payment-footnote">This does not mark the debt as settled. The balance updates only after the recipient confirms receipt.</p>
        <button className="linkbtn" onClick={onClose} disabled={disabled} style={{ display: "block", margin: "14px auto 0" }}>Cancel</button>
      </div>
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
    .map((member) => ({ label: member.id === user.id ? "You" : member.name, value: memberTotals[member.id] || 0, id: member.id }))
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
  savingSimplification,
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
        showSearch={false}
        value={settings.baseCurrency}
        onChange={(value) =>
          setSettings((previous) => ({ ...previous, baseCurrency: value }))
        }
        disabled={saving}
      />
      <div style={{ height: 12 }} />
      <CurrencySelect
        label="Spending currency · default for new expenses"
        showSearch={false}
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
        <LoadingButton
          className="btn-primary"
          loading={saving}
          disabled={saving}
          onClick={onSave}
          style={{ marginTop: 10 }}
        >
          {saving ? "Saving changes…" : "Save Changes"}
        </LoadingButton>
      )}

      {onCancel && (
        <button
          className="linkbtn"
          onClick={onCancel}
          disabled={saving || savingSimplification}
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
          disabled={savingSimplification}
          onChange={(event) => onSimplification(event.target.checked)}
          style={{ width: "auto" }}
        />
        Participate in suggested simplification
        {savingSimplification && <span className="button-spinner" role="status" aria-label="Saving preference" />}
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
                {member.id === user.id ? "You" : member.name}
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

function BalancesTab({ group, expenses, settlements, balData, user, memberName, onSettle, onReview }) {
  const { balances, simplified, baseCurrency } = balData;
  return (
    <>
      <div className="card balance-settle-up-overview">
        <h3 style={{ fontSize: 14.5, marginBottom: 4 }}>Simplified settle-up</h3>
        <p className="small muted" style={{ marginTop: 0, marginBottom: 14 }}>
          Review any reported payments separately from the balance still to pay.
        </p>
        {simplified.length === 0
          ? <p className="muted small">Everyone is settled up 🎉</p>
          : simplified.map((t, i) => {
            const related = settlements.filter((settlement) =>
              settlement.status !== "settled" &&
              settlement.from === t.from &&
              settlement.to === t.to
            );
            const unresolvedAmount = Math.round(related.reduce(
              (total, settlement) => total + Number(settlement.amount || 0), 0
            ) * 100) / 100;
            const remainingToSettle = Math.max(
              0,
              Math.round((Number(t.amount) - unresolvedAmount) * 100) / 100
            );
            const fromMember = group.members.find((member) => member.id === t.from);

            return (
              <div className="balance-settlement-card" key={i}>
                <div className="balance-settlement-summary">
                  <div
                    className="avatar balance-settlement-avatar"
                    style={{ background: avatarColor(t.from) }}
                    aria-hidden="true"
                  >
                    {initials(fromMember ? fromMember.name : memberName(t.from))}
                  </div>
                  <div className="balance-settlement-parties">
                    {t.from === user.id ? (
                      <>You owe <b>{memberName(t.to)}</b></>
                    ) : t.to === user.id ? (
                      <><b>{memberName(t.from)}</b> owes you</>
                    ) : (
                      <><b>{memberName(t.from)}</b> owes <b>{memberName(t.to)}</b></>
                    )}
                  </div>
                  <div className="balance-settlement-amount">{money(t.amount, baseCurrency)}</div>
                </div>

                {related.length > 0 && (
                  <div className="balance-payment-updates">
                    {related.map((settlement) => settlement.status === "reported_problem" ? (
                      <section className="balance-payment-issue" key={settlement.id} aria-label="Payment needs review">
                        <div className="balance-payment-issue-heading">
                          <span className="balance-payment-alert-icon" aria-hidden="true">!</span>
                          <div className="balance-payment-issue-copy">
                            <strong>Payment needs review</strong>
                            <p>
                              {settlement.to === user.id
                                ? "You marked this previous payment as not received."
                                : memberName(settlement.to) + " marked this previous payment as not received."}
                            </p>
                          </div>
                        </div>
                        <div className="balance-payment-issue-actions">
                          <span className="pill pill-coral balance-issue-pill">
                            Not received · {money(settlement.amount, baseCurrency)}
                          </span>
                          {t.from === user.id && (
                            <button
                              className="btn-ghost balance-review-button"
                              onClick={() => onReview(settlement)}
                            >
                              Review payment
                            </button>
                          )}
                        </div>
                      </section>
                    ) : (
                      <section className="balance-payment-awaiting" key={settlement.id}>
                        <span className="balance-awaiting-icon" aria-hidden="true">◷</span>
                        <div className="balance-payment-awaiting-copy">
                          <strong>Payment awaiting confirmation</strong>
                          <p>
                            {settlement.to === user.id
                              ? memberName(settlement.from) + " marked this amount as paid. Please confirm receipt."
                              : "Waiting for " + memberName(settlement.to) + " to confirm receipt."}
                          </p>
                        </div>
                        <strong className="balance-payment-awaiting-amount">
                          {money(settlement.amount, baseCurrency)}
                        </strong>
                      </section>
                    ))}
                  </div>
                )}

                {remainingToSettle > 0.009 && (
                  <div className="balance-remaining-card">
                    <div className="balance-remaining-icon" aria-hidden="true">₹</div>
                    <div className="balance-remaining-copy">
                      <strong>Remaining balance</strong>
                      <p>
                        {related.length > 0
                          ? "Excludes the payment update(s) shown above."
                          : ""}
                      </p>
                    </div>
                    <strong className="balance-remaining-amount">
                      {money(remainingToSettle, baseCurrency)}
                    </strong>
                    {t.from === user.id && (
                      <button
                        className="btn-primary balance-remaining-button"
                        onClick={() => onSettle(t.from, t.to, remainingToSettle)}
                      >
                        Settle remaining
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
              <div style={{ flex: 1, fontSize: 13.5 }}>{m.id === user.id ? "You" : m.name}</div>
              {pill}
            </div>
          );
        })}
      </div>
    </>
  );
}

function getRecordTimestamp(timestamp, fallbackDate) {
  if (timestamp) {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (fallbackDate) {
    const parsed = Date.parse(`${fallbackDate}T00:00:00.000Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function formatActivityTimestamp(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatActivityCalendarDate(dateValue) {
  if (!dateValue) return null;
  // Parse YYYY-MM-DD as a local calendar date, not UTC midnight.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(dateValue);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function localCalendarKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ActivityTimestamp({ timestamp, expenseDate }) {
  const formattedTimestamp = formatActivityTimestamp(timestamp);
  const hasDifferentExpenseDate = (() => {
    if (!expenseDate || !timestamp) return false;
    const eventDate = new Date(timestamp);
    return Number.isFinite(eventDate.getTime()) && localCalendarKey(eventDate) !== expenseDate;
  })();
  const formattedExpenseDate = hasDifferentExpenseDate
    ? formatActivityCalendarDate(expenseDate)
    : null;

  return (
    <div className="activity-meta">
      {formattedTimestamp ? (
        <time className="activity-event-time" dateTime={timestamp}>
          {formattedTimestamp}
        </time>
      ) : expenseDate ? (
        <span className="activity-event-time">
          {formatActivityCalendarDate(expenseDate)}
        </span>
      ) : null}
      {formattedExpenseDate && (
        <span className="activity-expense-date">
          Expense date: {formattedExpenseDate}
        </span>
      )}
    </div>
  );
}

function ActivityTab({ expenses, settlements, memberName, user }) {
  const items = [
    ...expenses.map((expense) => ({
      type: "expense",
      date: expense.date,
      occurredAt: expense.createdAt || expense.updatedAt || null,
      sortAt: getRecordTimestamp(expense.createdAt, expense.date),
      id: expense.id,
      e: expense
    })),
    ...settlements.map((settlement) => {
      const statusTimestamp = settlement.status === "settled"
        ? settlement.confirmedAt || settlement.updatedAt || settlement.createdAt
        : settlement.status === "reported_problem"
          ? settlement.reportedAt || settlement.updatedAt || settlement.createdAt
          : settlement.reportedAt || settlement.createdAt || settlement.updatedAt;
      return {
        type: "settle",
        date: settlement.date,
        occurredAt: statusTimestamp || null,
        sortAt: getRecordTimestamp(statusTimestamp, settlement.date),
        id: settlement.id,
        s: settlement
      };
    })
  ].sort((a, b) => b.sortAt - a.sortAt || String(b.id).localeCompare(String(a.id)));

  if (items.length === 0) return <div className="empty">No activity yet.</div>;

  return (
    <div className="card activity-feed">
      {items.map((item) => item.type === "expense" ? (
        <div className="split-row activity-item" key={item.id}>
          <span className="activity-item-icon" aria-hidden="true">{expenseIcon(item.e.desc)}</span>
          <div className="activity-item-content">
            <div className="activity-item-description">
              {memberName(item.e.paidBy)} added <b>{item.e.desc}</b>
            </div>
            <ActivityTimestamp timestamp={item.occurredAt} expenseDate={item.e.date} />
          </div>
        </div>
      ) : (
        <div className="split-row activity-item" key={item.id}>
          <span className="activity-item-icon" aria-hidden="true">
            {item.s.status === "settled" ? "✅" : item.s.status === "reported_problem" ? "⚠️" : "⏳"}
          </span>
          <div className="activity-item-content">
            <div className="activity-item-description">
              {item.s.status === "settled"
                ? <>{item.s.from === user.id ? "You" : memberName(item.s.from)} paid {item.s.to === user.id ? "you" : memberName(item.s.to)} <b>{money(item.s.amount, item.s.currency)}</b></>
                : item.s.status === "reported_problem"
                  ? <>{item.s.to === user.id ? "You reported a problem with" : memberName(item.s.to) + " reported a problem with"} the payment from {item.s.from === user.id ? "you" : memberName(item.s.from)} · <b>{money(item.s.amount, item.s.currency)}</b></>
                  : <>{item.s.from === user.id ? "You marked" : memberName(item.s.from) + " marked"} <b>{money(item.s.amount, item.s.currency)}</b> as paid · awaiting {item.s.to === user.id ? "your confirmation" : memberName(item.s.to) + "’s confirmation"}</>}
            </div>
            <ActivityTimestamp timestamp={item.occurredAt} />
          </div>
        </div>
      ))}
    </div>
  );
}

function InviteSheet({ group, user, invite, setInvite, onClose }) {
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const busy = Boolean(busyAction);
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
    setBusyAction("copy");

    try {
      const link = await getShareableLink();
      await navigator.clipboard.writeText(link);
      setCopied(true);
      showToast("Invite link copied successfully!");
    } catch (error) {
      showToast(error.message || "Could not copy invite link", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function shareLink() {
    setBusyAction("share");

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
      setBusyAction(null);
    }
  }

  async function regenerateLink() {
    setBusyAction("regenerate");

    try {
      await ensureInvite();
      setCopied(false);
      showToast("Invitation link regenerated");
    } catch (error) {
      showToast(error.message || "Could not regenerate link", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function revokeLink() {
    setBusyAction("revoke");

    try {
      await api.revokeInvite(group.id, { userId: user.id });
      setInvite(null);
      setRevoked(true);
      setCopied(false);
      showToast("Invitation revoked");
    } catch (error) {
      showToast(error.message || "Could not revoke link", "error");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div
      className="overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet">
        <button type="button" className="sheet-close-button" aria-label="Close invite dialog" onClick={onClose} disabled={busy}>×</button>
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

        <LoadingButton
          className="btn-primary"
          style={{ marginTop: 10 }}
          loading={busyAction === "copy"}
          disabled={busy}
          onClick={copyLink}
        >
          {busyAction === "copy" ? "Preparing invite link…" : copied ? "Copy invite link again" : "Copy invite link"}
        </LoadingButton>
        <LoadingButton
          className="invite-secondary-button"
          style={{ width: "100%", marginTop: 8 }}
          loading={busyAction === "share"}
          disabled={busy}
          onClick={shareLink}
        >
          {busyAction === "share" ? "Sharing…" : "Share link…"}
        </LoadingButton>
        <LoadingButton
          className="invite-secondary-button"
          style={{ width: "100%", marginTop: 8 }}
          loading={busyAction === "regenerate"}
          disabled={busy}
          onClick={regenerateLink}
        >
          {busyAction === "regenerate" ? "Regenerating…" : "Regenerate link"}
        </LoadingButton>
        <LoadingButton
          className="btn-danger-text"
          style={{ width: "100%", marginTop: 8 }}
          loading={busyAction === "revoke"}
          disabled={busy || !currentToken}
          onClick={revokeLink}
        >
          {busyAction === "revoke" ? "Revoking…" : "Revoke link"}
        </LoadingButton>
        <button
          className="linkbtn"
          onClick={onClose}
          disabled={busy}
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
  const [busyAction, setBusyAction] = useState(null);
  const busy = Boolean(busyAction);
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
    if (busy) return;
    setError("");
    if (!desc.trim()) { setError("Enter a description"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError("Enter a valid amount"); return; }
    if (includedIds.length === 0) { setError("Select at least one person to split with"); return; }
    let splits;
    try { splits = computeSplits(); } catch (e) { setError(e.message); return; }

    setBusyAction("save");
    try {
      const payload = { desc: desc.trim(), amount: Math.round(amt * 100) / 100, currency, paidBy, date, recurring: recurring || null, splitMethod, splits };
      if (editing) { await api.updateExpense(editing.id, payload); showToast("Expense updated successfully!"); }
      else { await api.addExpense(group.id, payload); showToast("Expense added successfully!"); }
      onSaved();
    } catch (e) {
      setError(e.message); showToast(e.message || "Could not save expense", "error");
    } finally { setBusyAction(null); }
  }

  async function del() {
    if (busy || !editing) return;
    setBusyAction("delete");
    try { await api.deleteExpense(editing.id); showToast("Expense deleted successfully!"); onDeleted(); }
    catch(e) { showToast(e.message || "Could not delete expense", "error"); }
    finally { setBusyAction(null); }
  }

  const amt = parseFloat(amount) || 0;

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <button type="button" className="sheet-close-button" aria-label="Close expense dialog" onClick={onClose} disabled={busy}>×</button>
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
            {members.map(m => (
              <option key={m.id} value={m.id}>
                {m.id === user.id ? `You (${m.name})` : m.name}
              </option>
            ))}
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
                <div style={{ flex: 1, fontSize: 13.5 }}>{m.id === user.id ? `You (${m.name})` : m.name}</div>
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
        <LoadingButton className="btn-primary" onClick={save} loading={busyAction === "save"} disabled={busy} style={{ marginTop: 8 }}>
          {busyAction === "save" ? (editing ? "Saving changes…" : "Adding expense…") : (editing ? "Save changes" : "Add expense")}
        </LoadingButton>
        {editing && (
          <LoadingButton className="btn-danger-text" onClick={del} loading={busyAction === "delete"} disabled={busy} style={{ width: "100%", marginTop: 10, background: "transparent", border: "none" }}>
            {busyAction === "delete" ? "Deleting expense…" : "Delete expense"}
          </LoadingButton>
        )}
        <button className="linkbtn" onClick={onClose} disabled={busy} style={{ display: "block", margin: "16px auto 0" }}>Cancel</button>
      </div>
    </div>
  );
}
