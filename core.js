/* ==========================================================
   LOT LEDGER — core ledger logic (no DOM, no network)
   One calculation, used by the dashboard, tenant balance,
   month-wise view and the PDF — so they can never disagree.

   Rules
   - Rent is charged in arrears: a month's rent falls due on the
     1st of the NEXT month. (Aug rent is due on 1 Sep.)
   - Tenant vacated  -> rent is charged through the vacate month, in full.
   - Agreement end   -> rent is charged through the end month, in full.
   - Revised rent applies from the month that contains "Effective from".
   - Opening balance -> rent is calculated from the month after the
     opening-balance date; earlier payments are ignored.
   - Payments are applied oldest-dues-first (opening balance, then
     the oldest month, and so on).
   - All dates are handled as LOCAL calendar dates (no UTC shifting).
   ========================================================== */
(function (root) {
  "use strict";

  const pad = (n) => String(n).padStart(2, "0");

  // Local calendar date -> "YYYY-MM-DD" (toISOString() would shift to UTC)
  function localISO(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function todayStr() { return localISO(new Date()); }

  // "YYYY-MM-DD..." -> local Date at midnight (null if empty/invalid)
  function parseYMD(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  const monthIndex = (d) => d.getFullYear() * 12 + d.getMonth();
  function monthLabel(idx, long) {
    const d = new Date(Math.floor(idx / 12), idx % 12, 1);
    return d.toLocaleString("en-IN", { month: long ? "long" : "short", year: "numeric" });
  }

  function isActive(t) {
    return t.Active !== false && String(t.Active).toUpperCase() !== "FALSE";
  }

  // "2026-10" (or "2026-10-01") -> "October 2026"
  function periodLabel(p) {
    const m = /^(\d{4})-(\d{2})/.exec(String(p || ""));
    if (!m) return "";
    return monthLabel(+m[1] * 12 + (+m[2] - 1), true);
  }

  // Default "rent period" for a payment made on dateStr = previous month, as "YYYY-MM"
  function prevMonthValue(dateStr) {
    const d = parseYMD(dateStr) || new Date();
    const idx = monthIndex(d) - 1;
    return Math.floor(idx / 12) + "-" + pad((idx % 12) + 1);
  }

  /**
   * Full ledger for one tenant.
   * @returns {{months, upcoming, opening, charged, paid, balance, lastChargedLabel}}
   *   months: oldest -> newest [{ label, rent, allocated, status }]
   *   status: "paid" | "partial" | "due"
   *   balance > 0 = owes money, < 0 = has credit/advance paid
   */
  function computeLedger(t, payments, today) {
    today = today || todayStr();
    const todayD = parseYMD(today);
    const curIdx = monthIndex(todayD);

    const openingDate = parseYMD(t.OpeningBalanceDate);
    const hasOpening = t.OpeningBalance !== undefined && t.OpeningBalance !== "" &&
      t.OpeningBalance !== null && !!openingDate;
    const opening = hasOpening ? Number(t.OpeningBalance) || 0 : 0;

    const start = parseYMD(t.StartDate);
    let first = hasOpening ? monthIndex(openingDate) + 1 : (start ? monthIndex(start) : curIdx);

    // Last month that has been charged
    let last = curIdx - 1;
    const vacated = parseYMD(t.VacatedDate);
    if (!isActive(t) && vacated) last = monthIndex(vacated);
    const end = parseYMD(t.AgreementEnd);
    if (end) last = Math.min(last, monthIndex(end));

    const revFrom = parseYMD(t.RevisedFrom);
    const revIdx = (t.RevisedRent && revFrom) ? monthIndex(revFrom) : null;
    const rentFor = (idx) =>
      (revIdx !== null && idx >= revIdx) ? Number(t.RevisedRent) : Number(t.MonthlyRent || 0);

    const months = [];
    for (let i = first; i <= last; i++) {
      months.push({ idx: i, label: monthLabel(i), rent: rentFor(i), allocated: 0, status: "due" });
    }

    // Payments for this tenant (ignore anything before the opening-balance date)
    let pays = (payments || []).filter((p) => p.TenantID === t.ID);
    if (hasOpening) {
      const cut = String(t.OpeningBalanceDate).slice(0, 10);
      pays = pays.filter((p) => String(p.Date).slice(0, 10) >= cut);
    }
    const paid = pays.reduce((s, p) => s + Number(p.Amount || 0), 0);

    // Apply payments oldest-first
    let remaining = paid;
    const openingPaid = Math.min(Math.max(opening, 0), remaining);
    remaining -= openingPaid;
    months.forEach((m) => {
      m.allocated = Math.min(m.rent, remaining);
      remaining -= m.allocated;
      m.status = m.allocated >= m.rent ? "paid" : (m.allocated > 0 ? "partial" : "due");
    });

    const charged = opening + months.reduce((s, m) => s + m.rent, 0);

    // The month currently running (not yet due) — shown as "upcoming", never counted
    let upcoming = null;
    const endOk = !end || monthIndex(end) >= curIdx;
    if (isActive(t) && curIdx > last && curIdx >= first && endOk) {
      upcoming = { label: monthLabel(curIdx), rent: rentFor(curIdx) };
    }

    return {
      months, upcoming, opening, openingPaid, charged, paid,
      balance: charged - paid,
      lastChargedLabel: months.length ? months[months.length - 1].label : ""
    };
  }

  const api = { localISO, todayStr, parseYMD, monthIndex, monthLabel, isActive,
    periodLabel, prevMonthValue, computeLedger };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LedgerCore = api;
})(typeof window !== "undefined" ? window : globalThis);
