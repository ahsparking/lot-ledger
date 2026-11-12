/* ==========================================================
   SAIFULLAH TAMEEM — Parking Rent Tracker App Logic
   ========================================================== */

const LS_CONFIG = "ll_config";
const LS_CACHE = "ll_cache";

let CONFIG = JSON.parse(localStorage.getItem(LS_CONFIG) || "{}");
let DATA = { properties: [], tenants: [], payments: [] };
let currentView = "dashboard";
let activeTenantId = null;
let lastReceiptCanvasBlobUrl = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n) => "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");
const { todayStr, parseYMD, isActive, computeLedger, periodLabel, prevMonthValue } = window.LedgerCore;

// Escape text before putting it into innerHTML (names/notes come from the sheet)
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------
// Toast
// ---------------------------------------------------------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// Wraps a button's onclick handler so it disables itself, shows "Saving…",
// and guards against double-taps while a save is already in flight —
// re-enabling automatically whether the save succeeds or fails.
function withSavingState(btn, label, handler) {
  const originalText = btn.textContent;
  btn.onclick = async () => {
    if (btn.disabled) return; // already saving — ignore extra taps
    btn.disabled = true;
    btn.textContent = label || "Saving…";
    try {
      await handler();
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  };
}

// ---------------------------------------------------------
// API
// ---------------------------------------------------------
async function api(action, payload = {}) {
  if (!CONFIG.apiUrl || !CONFIG.apiKey) {
    throw new Error("Not connected. Open Settings and paste your Apps Script URL & key.");
  }
  const res = await fetch(CONFIG.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, key: CONFIG.apiKey, ...payload })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function loadData(showToast) {
  try {
    const res = await api("getAll");
    DATA.properties = res.properties || [];
    DATA.tenants = res.tenants || [];
    DATA.payments = res.payments || [];
    localStorage.setItem(LS_CACHE, JSON.stringify({ ...DATA, syncedAt: Date.now() }));
    setConnStatus(true);
    if (showToast) toast("Synced with Google Sheet");
  } catch (err) {
    const cached = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
    if (cached) {
      DATA.properties = cached.properties;
      DATA.tenants = cached.tenants;
      DATA.payments = cached.payments;
    }
    setConnStatus(false, err.message);
  }
  renderAll();
}

function setConnStatus(ok, msg) {
  const el = $("#connStatus");
  const sub = $("#headerSub");
  if (!CONFIG.apiUrl) {
    el.textContent = "Not connected yet. Paste your Apps Script URL & key below.";
    sub.textContent = "Not connected";
    return;
  }
  if (ok) {
    el.innerHTML = '<span class="badge-live"><span class="dot"></span>Connected — live data</span>';
    sub.textContent = "Synced just now";
  } else {
    el.textContent = "Couldn't reach the sheet (" + (msg || "check URL/key") + "). Showing last saved data.";
    sub.textContent = "Offline — showing cached data";
  }
  const last = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
  $("#lastSync").textContent = last ? new Date(last.syncedAt).toLocaleString("en-IN") : "never";
}

// ---------------------------------------------------------
// Balance computation (Monthly Due Cycle)
// ---------------------------------------------------------

function tenantPayments(tenantId) {
  return DATA.payments.filter((p) => p.TenantID === tenantId)
    .sort((a, b) => String(b.Date).localeCompare(String(a.Date)));
}

function currentRent(t) {
  const rf = parseYMD(t.RevisedFrom);
  if (t.RevisedRent && rf && rf <= parseYMD(todayStr())) return Number(t.RevisedRent);
  return Number(t.MonthlyRent || 0);
}

// Single source of truth — see core.js for the rules.
function tenantLedger(t) { return computeLedger(t, DATA.payments, todayStr()); }
function tenantBalance(t) {
  const L = tenantLedger(t);
  return { charged: L.charged, paid: L.paid, balance: L.balance };
}

function propertyName(id) {
  const p = DATA.properties.find((p) => p.ID === id);
  return p ? p.Name : "—";
}

// ---------------------------------------------------------
// Rendering
// ---------------------------------------------------------
function renderAll() {
  renderDashboard();
  renderPropertyOptions();
  renderTenantList(currentTenantFilter());
  renderPayTenantOptions();
}

function renderDashboard() {
  const activeTenants = DATA.tenants.filter(isActive);
  const vacatedTenants = DATA.tenants.filter((t) => !isActive(t));
  let totalDue = 0, dueCount = 0;
  activeTenants.forEach((t) => {
    const { balance } = tenantBalance(t);
    if (balance > 0) { totalDue += balance; dueCount++; }
  });

  const cutoff = Date.now() - 30 * 86400000;
  const collected30 = DATA.payments
    .filter((p) => new Date(p.Date).getTime() >= cutoff)
    .reduce((s, p) => s + Number(p.Amount || 0), 0);

  $("#heroTotal").textContent = fmt(totalDue);
  $("#heroSub").textContent = dueCount === 0
    ? (activeTenants.length ? "All tenants are settled 🎉" : (DATA.tenants.length ? "No active tenants" : "Add a tenant to get started"))
    : dueCount + " tenant" + (dueCount > 1 ? "s" : "") + " owe rent right now";
  $("#statTenantsDue").textContent = dueCount;
  $("#statCollectedMonth").textContent = fmt(collected30);
  $("#statProperties").textContent = DATA.properties.length;

  const wrap = $("#propertyScroll");
  wrap.innerHTML = "";
  DATA.properties.forEach((p) => {
    const tenants = activeTenants.filter((t) => t.PropertyID === p.ID);
    let due = 0;
    tenants.forEach((t) => { const b = tenantBalance(t).balance; if (b > 0) due += b; });
    const chip = document.createElement("div");
    chip.className = "property-chip";
    chip.innerHTML = `<div class="pc-type">${esc(p.Type || "Lot")}</div>
      <div class="pc-name">${esc(p.Name)}</div>
      <div class="pc-amt ${due > 0 ? "" : "clear"} mono">${due > 0 ? fmt(due) + " due" : "All clear"}</div>`;
    chip.onclick = () => { showTenantFilter("all"); switchView("tenants"); };
    wrap.appendChild(chip);
  });
  if (!DATA.properties.length) {
    wrap.innerHTML = `<div class="empty-state" style="width:100%"><p>No lots yet.</p><button class="btn btn-primary" onclick="openSheet('sheetAddProperty')">+ Add your first lot</button></div>`;
  }

  const dueListEl = $("#dueList");
  const sorted = activeTenants
    .map((t) => ({ t, b: tenantBalance(t) }))
    .filter((x) => x.b.balance > 0)
    .sort((a, b) => b.b.balance - a.b.balance)
    .slice(0, 5);
  dueListEl.innerHTML = "";
  if (!sorted.length && activeTenants.length) {
    dueListEl.innerHTML = `<div class="empty-state"><p>Nobody's pending. Nice work.</p></div>`;
  }
  sorted.forEach(({ t, b }) => dueListEl.appendChild(ticketCard(t, b)));

  // Money still owed by tenants who have already left — hidden from the lists above,
  // but never silently forgotten.
  let vacDue = 0, vacCount = 0;
  vacatedTenants.forEach((t) => { const b = tenantBalance(t).balance; if (b > 0) { vacDue += b; vacCount++; } });
  const vn = $("#vacatedNote");
  if (vacCount) {
    vn.style.display = "block";
    vn.innerHTML = `<b class="mono">${fmt(vacDue)}</b> still pending from ${vacCount} vacated tenant${vacCount > 1 ? "s" : ""} · <u>view</u>`;
    vn.onclick = () => { showTenantFilter("vacated"); switchView("tenants"); };
  } else {
    vn.style.display = "none";
  }
}

function renderPropertyOptions() {
  const sel = $("#atProperty");
  sel.innerHTML = DATA.properties.map((p) => `<option value="${esc(p.ID)}">${esc(p.Name)}</option>`).join("") ||
    `<option value="">Add a lot first</option>`;
}

function ticketCard(t, b) {
  const active = isActive(t);
  const el = document.createElement("div");
  el.className = "ticket" + (active ? "" : " vacated");
  const pill = !active ? "vacated" : (b.balance > 0 ? "due" : "clear");
  const pillText = !active ? "Vacated" + (t.VacatedDate ? " · " + esc(String(t.VacatedDate).slice(0, 10)) : "")
    : (b.balance > 0 ? "Due" : "Cleared");
  el.innerHTML = `
    <div class="ticket-stub"><span class="spot-label">${esc(t.SpotLabel || "—")}</span></div>
    <div class="ticket-divider"></div>
    <div class="ticket-body">
      <div class="ticket-top">
        <div>
          <div class="ticket-name">${esc(t.Name)}</div>
          <div class="ticket-meta">${esc(propertyName(t.PropertyID))}</div>
        </div>
        <div class="ticket-amt ${b.balance > 0 ? "due" : "paid"} mono">${b.balance > 0 ? fmt(b.balance) : (b.balance < 0 ? fmt(b.balance) + " adv" : "₹0")}</div>
      </div>
      <span class="status-pill ${pill}">${pillText}</span>
    </div>`;
  el.onclick = () => openTenantProfile(t.ID);
  return el;
}

function currentTenantFilter() {
  return $("#tenantFilter .active")?.dataset.filter || "all";
}
function showTenantFilter(f) {
  $$("#tenantFilter button").forEach((b) => b.classList.toggle("active", b.dataset.filter === f));
  renderTenantList(f);
}

function renderTenantList(filter) {
  const list = $("#tenantList");
  if (!list) return;
  list.innerHTML = "";

  // Vacated tab shows its count so you know whether there is anything inside
  const vacBtn = $('#tenantFilter [data-filter="vacated"]');
  const vacCount = DATA.tenants.filter((t) => !isActive(t)).length;
  if (vacBtn) vacBtn.textContent = "Vacated" + (vacCount ? " (" + vacCount + ")" : "");

  if (!DATA.tenants.length) {
    list.innerHTML = `<div class="empty-state"><p>No tenants added yet.</p><button class="btn btn-primary" onclick="openSheet('sheetAddTenant')">+ Add tenant</button></div>`;
    return;
  }
  const showVacated = filter === "vacated";
  const pool = DATA.tenants.filter((t) => isActive(t) !== showVacated);
  if (showVacated) {
    const h = document.createElement("p");
    h.className = "helper-text";
    h.style.margin = "0 0 4px";
    h.textContent = vacCount
      ? "Tenants who have left. Open one to see their full history, or reactivate them."
      : "No vacated tenants. When a tenant leaves, open their profile and tap “Mark as vacated”.";
    list.appendChild(h);
  }
  const byProp = {};
  pool.forEach((t) => { (byProp[t.PropertyID] = byProp[t.PropertyID] || []).push(t); });
  Object.keys(byProp).forEach((propId) => {
    const filtered = byProp[propId].filter((t) => {
      const b = tenantBalance(t).balance;
      if (filter === "due") return b > 0;
      if (filter === "clear") return b <= 0;
      return true;
    });
    if (!filtered.length) return;
    const label = document.createElement("div");
    label.className = "group-label";
    label.textContent = propertyName(propId);
    list.appendChild(label);
    filtered
      .map((t) => ({ t, b: tenantBalance(t) }))
      .sort((x, y) => y.b.balance - x.b.balance)
      .forEach(({ t, b }) => list.appendChild(ticketCard(t, b)));
  });
}

// Active tenants, plus vacated tenants who still owe money (so final dues can be recorded)
function payableTenants() {
  return DATA.tenants.filter((t) => isActive(t) || tenantBalance(t).balance > 0);
}

function renderPayTenantOptions() {
  const sel = $("#payTenant");
  const prev = sel.value;
  sel.innerHTML = payableTenants().map((t) =>
    `<option value="${esc(t.ID)}">${esc(t.Name)} — ${esc(propertyName(t.PropertyID))} (${esc(t.SpotLabel || "—")})${isActive(t) ? "" : " · vacated"}</option>`
  ).join("") || `<option value="">Add a tenant first</option>`;
  if (prev) sel.value = prev;
  updatePayBalanceBox();
}

function updatePayBalanceBox() {
  const id = $("#payTenant").value;
  const t = DATA.tenants.find((x) => x.ID === id);
  const box = $("#payTenantBalanceBox");
  if (!t) { box.style.display = "none"; return; }
  const b = tenantBalance(t);
  box.style.display = "block";
  $("#payTenantBalance").textContent = b.balance > 0 ? fmt(b.balance) : "₹0";
  $("#payTenantBalance").className = "amt mono " + (b.balance > 0 ? "due" : "clear");
  $("#payTenantBalanceLbl").textContent = b.balance > 0 ? "currently pending" : "all settled";
}

// ---------------------------------------------------------
// Navigation
// ---------------------------------------------------------
let payPeriodTouched = false;
function syncPayPeriod() {
  if (!payPeriodTouched) $("#payPeriod").value = prevMonthValue($("#payDate").value || todayStr());
}

function switchView(name) {
  currentView = name;
  $$(".view").forEach((v) => v.classList.remove("active"));
  $("#view-" + name).classList.add("active");
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  
  if (name === "add") {
    $("#payDate").value = todayStr();
    payPeriodTouched = false;
    syncPayPeriod();
    renderPayTenantOptions();
  } else if (name === "tenants") {
    renderTenantList(currentTenantFilter());
  }
  window.scrollTo(0, 0);
}
$$("[data-nav]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.nav)));

// ---------------------------------------------------------
// Sheets (modals)
// ---------------------------------------------------------
function openSheet(id) { $("#" + id).classList.add("open"); }
function closeSheet(id) { $("#" + id).classList.remove("open"); }
$$(".sheet-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
});

function openTenantProfile(id) {
  activeTenantId = id;
  const t = DATA.tenants.find((x) => x.ID === id);
  if (!t) return;
  const active = isActive(t);
  const b = tenantBalance(t);
  $("#tpAvatar").textContent = (t.Name || "?").charAt(0).toUpperCase();
  $("#tpName").textContent = t.Name;
  $("#tpSub").textContent = `${propertyName(t.PropertyID)} · Spot ${t.SpotLabel || "—"} · ${fmt(currentRent(t))}/mo` +
    (active ? "" : " · Vacated" + (t.VacatedDate ? " " + String(t.VacatedDate).slice(0, 10) : ""));
  $("#tpBalance").textContent = b.balance > 0 ? fmt(b.balance) : (b.balance < 0 ? fmt(b.balance) + " advance" : "₹0");
  $("#tpBalance").className = "amt mono " + (b.balance > 0 ? "due" : "clear");
  $("#tpBalanceLbl").textContent = b.balance > 0 ? "pending balance" : "fully settled";

  // Action buttons
  const btnRow = $("#tpProfileBtnRow");
  btnRow.innerHTML = `
    ${(active || b.balance > 0) ? `<button class="btn btn-primary" id="tpBtnRecordPayment" style="flex: 1 1 100%;">Record payment</button>` : ""}
    <button class="btn btn-secondary" id="tpBtnStatement" style="flex: 1;">Share balance sheet</button>
    <button class="btn btn-secondary" id="tpBtnMonthwise" style="flex: 1;">Month wise</button>
  `;
  const rp = $("#tpBtnRecordPayment");
  if (rp) rp.onclick = () => {
    closeSheet("sheetTenant");
    switchView("add");
    $("#payTenant").value = activeTenantId;
    updatePayBalanceBox();
  };
  $("#tpBtnStatement").onclick = () => generateReceipt({ mode: "statement", tenant: t });
  $("#tpBtnMonthwise").onclick = () => openMonthwiseModal(t);

  // Vacate / reactivate
  const lc = $("#tpBtnLifecycle");
  if (active) {
    lc.textContent = "Mark as vacated";
    lc.className = "btn btn-danger-ghost";
    lc.onclick = () => openVacateSheet(t);
  } else {
    lc.textContent = "Reactivate tenant";
    lc.className = "btn btn-ghost";
    lc.onclick = () => reactivateTenant(t);
  }

  // Details
  const details = $("#tpDetails");
  const detailRows = [];
  if (!active) detailRows.push(["Status", "Vacated" + (t.VacatedDate ? " on " + String(t.VacatedDate).slice(0, 10) : "")]);
  if (!active && t.VacateNote) detailRows.push(["Vacate note", t.VacateNote]);
  if (t.Phone) detailRows.push(["Phone", t.Phone]);
  if (t.Address) detailRows.push(["Address", t.Address]);
  const vehBits = [];
  if (Number(t.CarCount)) vehBits.push(t.CarCount + " car" + (t.CarCount > 1 ? "s" : ""));
  if (Number(t.BikeCount)) vehBits.push(t.BikeCount + " bike" + (t.BikeCount > 1 ? "s" : ""));
  detailRows.push(["Vehicle", (t.VehicleType || "—") + (vehBits.length ? " · " + vehBits.join(", ") : "")]);
  detailRows.push(["Fixed rent", fmt(t.MonthlyRent)]);
  if (t.RevisedRent) detailRows.push(["Revised rent", fmt(t.RevisedRent) + " (from " + String(t.RevisedFrom).slice(0, 10) + ")"]);
  if (t.Advance) detailRows.push(["Advance held", fmt(t.Advance)]);
  if (t.OpeningBalanceDate) detailRows.push(["Opening balance", fmt(t.OpeningBalance || 0) + " as of " + String(t.OpeningBalanceDate).slice(0, 10)]);
  detailRows.push(["Agreement", String(t.StartDate).slice(0, 10) + (t.AgreementEnd ? " → " + String(t.AgreementEnd).slice(0, 10) : " → ongoing")]);
  details.innerHTML = "";
  detailRows.forEach(([k, v]) => {
    const row = document.createElement("div");
    row.className = "pay-row";
    row.innerHTML = `<div>${esc(k)}</div><div class="pr-amt" style="font-family:var(--font-body);font-weight:500">${esc(v)}</div>`;
    details.appendChild(row);
  });

  // Payment history
  const hist = $("#tpHistory");
  const pays = tenantPayments(id);
  hist.innerHTML = pays.length ? "" : '<div class="helper-text">No payments recorded yet.</div>';
  pays.forEach((p) => {
    const per = periodLabel(p.Period);
    const row = document.createElement("div");
    row.className = "pay-row";
    row.innerHTML = `<div><div>${esc(p.Mode || "Payment")}${per ? " · for " + esc(per) : ""}${p.Note ? " · " + esc(p.Note) : ""}</div><div class="pr-date">${esc(String(p.Date).slice(0, 10))}</div></div><div class="pr-amt">${fmt(p.Amount)}</div>`;
    hist.appendChild(row);
  });
  openSheet("sheetTenant");
}

// ---------------------------------------------------------
// Vacate / reactivate a tenant
// ---------------------------------------------------------
let vacateTenant = null;

function updateVacateSummary() {
  const t = vacateTenant;
  if (!t) return;
  const date = $("#vcDate").value || todayStr();
  // Preview: what the ledger will look like once vacated on this date
  const L = computeLedger({ ...t, Active: false, VacatedDate: date }, DATA.payments, todayStr());
  const adv = Number(t.Advance || 0);
  const net = L.balance - adv;
  const rows = [
    ["Rent charged up to", L.lastChargedLabel || "—"],
    ["Pending rent", L.balance > 0 ? fmt(L.balance) : (L.balance < 0 ? fmt(L.balance) + " credit" : "₹0")]
  ];
  if (adv) rows.push(["Advance held", fmt(adv)]);
  if (adv) rows.push([net > 0 ? "Tenant still owes (after advance)" : "To refund tenant (after dues)", fmt(net)]);
  $("#vcSummary").innerHTML = rows.map(([k, v]) =>
    `<div class="pay-row"><div>${esc(k)}</div><div class="pr-amt">${esc(v)}</div></div>`).join("");
  $("#vcWarn").style.display = L.balance > 0 ? "block" : "none";
}

function openVacateSheet(t) {
  vacateTenant = t;
  closeSheet("sheetTenant");
  $("#vcName").textContent = t.Name;
  $("#vcDate").value = todayStr();
  $("#vcNote").value = "";
  updateVacateSummary();
  openSheet("sheetVacate");
}
$("#vcDate").addEventListener("change", updateVacateSummary);

withSavingState($("#btnConfirmVacate"), "Saving…", async () => {
  const t = vacateTenant;
  if (!t) return;
  const date = $("#vcDate").value || todayStr();
  try {
    await api("updateTenant", { id: t.ID, active: false, vacatedDate: date, vacateNote: $("#vcNote").value.trim() });
    toast(t.Name + " marked as vacated");
    closeSheet("sheetVacate");
    await loadData();
  } catch (e) { toast(e.message); }
});

async function reactivateTenant(t) {
  if (!confirm("Reactivate " + t.Name + "? Rent will be charged as normal again, including any months since they left.")) return;
  try {
    await api("updateTenant", { id: t.ID, active: true, vacatedDate: "", vacateNote: "" });
    toast(t.Name + " is active again");
    closeSheet("sheetTenant");
    await loadData();
    showTenantFilter("all");
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------
// Month-wise view (newest first) — driven by the same ledger as the balance
// ---------------------------------------------------------
let activeMonthwise = null; // { tenant, ledger }

function openMonthwiseModal(t) {
  const container = $("#mwContent");
  const L = tenantLedger(t);
  activeMonthwise = { tenant: t, ledger: L };
  const col = (st) => st === "paid" ? "color:var(--green);" : (st === "partial" ? "color:var(--amber);" : "color:var(--rust);");
  const label = (st) => st === "paid" ? "Cleared" : (st === "partial" ? "Part paid" : "Pending");
  const rowHtml = (left, right, rightStyle, subL, subR) => `
    <div class="pay-row" style="flex-direction:column; gap:4px; padding:12px 0; border-bottom: 1px solid var(--line);">
      <div style="display:flex; justify-content:space-between; width:100%; font-weight:600; font-size:15px;">
        <div>${esc(left)}</div><div style="${rightStyle}">${esc(right)}</div>
      </div>
      <div style="display:flex; justify-content:space-between; width:100%; font-size:13px; color:var(--ink-soft);">
        <div>${esc(subL)}</div><div style="font-weight:600;">${esc(subR)}</div>
      </div>
    </div>`;

  let html = `<div class="pay-history">`;
  if (L.upcoming) {
    html += rowHtml(L.upcoming.label, fmt(L.upcoming.rent), "color:var(--ink-soft);",
      "Running month — falls due on the 1st of next month", "Upcoming");
  }
  for (let i = L.months.length - 1; i >= 0; i--) {
    const m = L.months[i];
    html += rowHtml(m.label, `${fmt(m.allocated)} / ${fmt(m.rent)}`, col(m.status),
      m.status === "paid" ? "" : `Short by ${fmt(m.rent - m.allocated)}`, label(m.status));
  }
  if (L.opening) {
    const st = L.openingPaid >= L.opening ? "paid" : (L.openingPaid > 0 ? "partial" : "due");
    html += rowHtml("Opening balance", `${fmt(L.openingPaid)} / ${fmt(L.opening)}`, col(st),
      "Carried over from before this app", label(st));
  }
  if (!L.months.length && !L.opening && !L.upcoming) html += `<div class="helper-text">No monthly breakdown available yet.</div>`;
  html += `</div>
    <div class="balance-box" style="margin-top:12px">
      <div class="amt mono ${L.balance > 0 ? "due" : "clear"}">${L.balance > 0 ? fmt(L.balance) : (L.balance < 0 ? fmt(L.balance) + " credit" : "₹0")}</div>
      <div class="lbl">${L.balance > 0 ? "total outstanding" : "fully settled"} · payments are applied to the oldest dues first</div>
    </div>`;
  container.innerHTML = html;
  $("#mwTitle").textContent = `${t.Name} — Month-wise`;
  openSheet("sheetMonthwise");
}

// ---------------------------------------------------------
// Month-wise PDF export (for sharing outstanding statement with tenant)
// ---------------------------------------------------------
function exportMonthwisePDF(t, L) {
  if (!window.jspdf) { toast("PDF library didn't load — check your connection"); return; }
  if (!L || (!L.months.length && !L.opening)) { toast("Nothing to export yet"); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const bottomLimit = pageH - 60;
  let y = 50;

  const col = { month: marginX, rent: marginX + 160, paid: marginX + 280, status: marginX + 400 };

  function drawTableHeader() {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    doc.text("Month", col.month, y);
    doc.text("Rent", col.rent, y);
    doc.text("Paid", col.paid, y);
    doc.text("Status", col.status, y);
    y += 6;
    doc.setDrawColor(210);
    doc.line(marginX, y, pageW - marginX, y);
    y += 18;
    doc.setTextColor(20, 20, 20);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(CONFIG.bizName || "Parking Rent Statement", marginX, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  if (CONFIG.bizPhone) { doc.text("Contact: " + CONFIG.bizPhone, marginX, y); y += 14; }
  doc.text("Statement generated on " + new Date().toLocaleDateString("en-IN"), marginX, y);
  y += 26;

  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`${t.Name} — Month-wise Statement`, marginX, y);
  if (t.SpotLabel) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text("Spot: " + t.SpotLabel, pageW - marginX, y, { align: "right" });
    doc.setTextColor(20, 20, 20);
  }
  y += 14;
  doc.setDrawColor(160);
  doc.line(marginX, y, pageW - marginX, y);
  y += 24;

  drawTableHeader();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const statusText = { paid: "Cleared", partial: "Part paid", due: "Pending" };
  const statusRGB = { paid: [30, 140, 60], partial: [190, 130, 20], due: [190, 60, 60] };
  const rows = [];
  if (L.opening) {
    const st = L.openingPaid >= L.opening ? "paid" : (L.openingPaid > 0 ? "partial" : "due");
    rows.push({ label: "Opening balance", rent: L.opening, paid: L.openingPaid, st });
  }
  L.months.forEach((m) => rows.push({ label: m.label, rent: m.rent, paid: m.allocated, st: m.status }));

  rows.forEach((r) => {
    if (y > bottomLimit) { doc.addPage(); y = 50; drawTableHeader(); }
    doc.setTextColor(20, 20, 20);
    doc.text(r.label, col.month, y);
    doc.text(fmt(r.rent), col.rent, y);
    doc.text(fmt(r.paid), col.paid, y);
    doc.setTextColor(...statusRGB[r.st]);
    doc.text(statusText[r.st], col.status, y);
    y += 18;
  });

  y += 8;
  doc.setDrawColor(160);
  doc.line(marginX, y, pageW - marginX, y);
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text(L.balance < 0 ? "Advance / credit: " + fmt(L.balance) : "Total outstanding: " + fmt(L.balance), marginX, y);

  const fileName = `${t.Name.replace(/\s+/g, "_")}_statement.pdf`;
  const blob = doc.output("blob");
  if (navigator.canShare && navigator.share) {
    const file = new File([blob], fileName, { type: "application/pdf" });
    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: fileName }).catch(() => doc.save(fileName));
      return;
    }
  }
  doc.save(fileName);
}

$("#btnExportMonthwisePDF").onclick = () => {
  if (!activeMonthwise) return toast("Open a tenant's month-wise view first");
  exportMonthwisePDF(activeMonthwise.tenant, activeMonthwise.ledger);
};

$("#tpBtnEdit").onclick = () => {
  const t = DATA.tenants.find((x) => x.ID === activeTenantId);
  closeSheet("sheetTenant");
  $("#atName").value = t.Name;
  $("#atPhone").value = t.Phone || "";
  $("#atAddress").value = t.Address || "";
  renderPropertyOptions();
  $("#atProperty").value = t.PropertyID;
  $("#atSpot").value = t.SpotLabel || "";
  $("#atVehicleType").value = t.VehicleType || "Car";
  $("#atCarCount").value = t.CarCount || "";
  $("#atBikeCount").value = t.BikeCount || "";
  $("#atRent").value = t.MonthlyRent;
  $("#atAdvance").value = t.Advance || "";
  $("#atStart").value = t.StartDate;
  $("#atEnd").value = t.AgreementEnd || "";
  $("#atRevisedRent").value = t.RevisedRent || "";
  $("#atRevisedFrom").value = t.RevisedFrom || "";
  $("#atOpeningBalance").value = t.OpeningBalance || "";
  $("#atOpeningDate").value = t.OpeningBalanceDate || "";
  $("#atEditId").textContent = t.ID;
  openSheet("sheetAddTenant");
};

// ---------------------------------------------------------
// Forms: property / tenant / payment
// ---------------------------------------------------------
$("#btnAddPropertyTop").onclick = () => openSheet("sheetAddProperty");
$("#btnAddTenantTop").onclick = () => {
  $("#atEditId").textContent = "";
  $("#atName").value = ""; $("#atPhone").value = ""; $("#atAddress").value = "";
  $("#atSpot").value = ""; $("#atVehicleType").value = "Car";
  $("#atCarCount").value = ""; $("#atBikeCount").value = "";
  $("#atRent").value = ""; $("#atAdvance").value = "";
  $("#atStart").value = todayStr(); $("#atEnd").value = "";
  $("#atRevisedRent").value = ""; $("#atRevisedFrom").value = "";
  $("#atOpeningBalance").value = ""; $("#atOpeningDate").value = "";
  renderPropertyOptions();
  openSheet("sheetAddTenant");
};

withSavingState($("#btnSaveProperty"), "Saving…", async () => {
  const name = $("#apName").value.trim();
  if (!name) return toast("Enter a lot name");
  try {
    await api("addProperty", { name, type: $("#apType").value });
    toast("Lot added");
    $("#apName").value = "";
    closeSheet("sheetAddProperty");
    await loadData();
  } catch (e) { toast(e.message); }
});

withSavingState($("#btnSaveTenant"), "Saving…", async () => {
  const name = $("#atName").value.trim();
  const propertyId = $("#atProperty").value;
  const rent = $("#atRent").value;
  const start = $("#atStart").value;
  if (!name || !propertyId || !rent || !start) return toast("Fill in name, lot, rent and start date");
  const editId = $("#atEditId").textContent;
  const common = {
    name,
    phone: $("#atPhone").value,
    address: $("#atAddress").value,
    spotLabel: $("#atSpot").value,
    vehicleType: $("#atVehicleType").value,
    carCount: $("#atCarCount").value,
    bikeCount: $("#atBikeCount").value,
    monthlyRent: rent,
    advance: $("#atAdvance").value,
    revisedRent: $("#atRevisedRent").value,
    revisedFrom: $("#atRevisedFrom").value,
    agreementEnd: $("#atEnd").value,
    openingBalance: $("#atOpeningBalance").value,
    openingBalanceDate: $("#atOpeningDate").value
  };
  try {
    if (editId) {
      await api("updateTenant", { id: editId, ...common });
      toast("Tenant updated");
    } else {
      await api("addTenant", { ...common, propertyId, startDate: start });
      toast("Tenant added");
    }
    closeSheet("sheetAddTenant");
    await loadData();
  } catch (e) { toast(e.message); }
});

$("#payTenant").addEventListener("change", updatePayBalanceBox);
$("#payDate").addEventListener("change", syncPayPeriod);
$("#payPeriod").addEventListener("change", () => { payPeriodTouched = true; });

withSavingState($("#btnSavePayment"), "Saving…", async () => {
  const tenantId = $("#payTenant").value;
  const amount = Number($("#payAmount").value);
  const date = $("#payDate").value || todayStr();
  if (!tenantId) return toast("Add a tenant first");
  if (!amount || amount <= 0) return toast("Enter a valid amount");
  try {
    const period = $("#payPeriod").value || prevMonthValue(date);
    await api("addPayment", { tenantId, amount, date, mode: $("#payMode").value, note: $("#payNote").value, period });
    await loadData();
    toast("Payment saved");
    const t = DATA.tenants.find((x) => x.ID === tenantId);
    generateReceipt({ mode: "payment", tenant: t, amount, date, payMode: $("#payMode").value, note: $("#payNote").value, period });
    $("#payAmount").value = ""; $("#payNote").value = "";
    switchView("dashboard");
  } catch (e) { toast(e.message); }
});

// ---------------------------------------------------------
// Receipt / statement image generation (canvas)
// ---------------------------------------------------------
async function generateReceipt({ mode, tenant, amount, date, payMode, note, period }) {
  await document.fonts.ready;
  const canvas = $("#receiptCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const b = tenantBalance(tenant);
  const isPaid = mode === "payment";

  const teal = "#1F4A44", rust = "#BA4A24", green = "#2F7A4F", ink = "#16233A",
    inkSoft = "#5B6478", cream = "#FDFDFB", line = "#E1E3DA";

  // background
  ctx.fillStyle = cream;
  roundRect(ctx, 0, 0, W, H, 26); ctx.fill();

  // header band
  ctx.fillStyle = teal;
  ctx.beginPath();
  ctx.moveTo(26, 0); ctx.lineTo(W - 26, 0);
  ctx.arcTo(W, 0, W, 26, 26); ctx.lineTo(W, 215);
  ctx.lineTo(0, 215); ctx.lineTo(0, 26); ctx.arcTo(0, 0, 26, 0, 26);
  ctx.closePath(); ctx.fill();

  // Business Name & Phone
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "600 24px Inter";
  ctx.fillText((CONFIG.bizName || "Saifullah Tameem"), 40, 58);
  ctx.font = "500 17px Inter";
  if (CONFIG.bizPhone) ctx.fillText(CONFIG.bizPhone, 40, 86);

  // Title & Date Subtitle
  ctx.fillStyle = "#fff";
  ctx.font = "700 28px 'Space Grotesk'";
  ctx.fillText(isPaid ? "PAYMENT RECEIPT" : "BALANCE STATEMENT", 40, 136);

  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.font = "500 16px 'IBM Plex Mono'";
  ctx.fillText((isPaid ? "Received on " : "As of ") + (date || todayStr()), 40, 168);

  // Status Stamp Circle
  ctx.save();
  ctx.translate(W - 95, 105);
  ctx.rotate(-0.18);
  ctx.strokeStyle = "rgba(255,255,255,.65)";
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 17px Inter";
  ctx.textAlign = "center";
  const stampText = isPaid ? (b.balance > 0 ? "PARTIAL" : "PAID") : (b.balance > 0 ? "DUE" : "CLEAR");
  ctx.fillText(stampText, 0, 6);
  ctx.textAlign = "left";
  ctx.restore();

  // Perforation dots
  ctx.fillStyle = cream;
  for (let x = 30; x < W - 20; x += 22) {
    ctx.beginPath(); ctx.arc(x, 215, 7, 0, Math.PI * 2); ctx.fill();
  }

  let y = 260;
  // Big Amount Section
  ctx.fillStyle = inkSoft;
  ctx.font = "600 17px Inter";
  ctx.fillText(isPaid ? "Amount received" : "Total amount due", 40, y);
  y += 64;
  ctx.font = "700 58px 'IBM Plex Mono'";
  ctx.fillStyle = isPaid ? green : (b.balance > 0 ? rust : green);
  ctx.fillText(fmt(isPaid ? amount : Math.max(b.balance, 0)), 40, y);
  y += 38;

  // Divider
  ctx.strokeStyle = line; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
  y += 38;

  // Detail Rows
  const rows = [];
  rows.push(["Tenant", tenant.Name]);
  rows.push(["Lot / spot", `${propertyName(tenant.PropertyID)} · ${tenant.SpotLabel || "—"}`]);
  if (isPaid) rows.push(["Rent period", periodLabel(period) || periodLabel(prevMonthValue(date))]);
  else if (tenantLedger(tenant).lastChargedLabel) rows.push(["Rent charged up to", tenantLedger(tenant).lastChargedLabel]);
  rows.push(["Monthly rent", fmt(currentRent(tenant))]);
  if (isPaid) {
    rows.push(["Mode", payMode || "—"]);
    if (note) rows.push(["Note", note]);
  }
  rows.push([isPaid ? "Balance after payment" : "Balance", b.balance > 0 ? fmt(b.balance) + " due" : (b.balance < 0 ? fmt(b.balance) + " advance" : "Settled")]);

  // Render Table Rows
  rows.forEach(([k, v]) => {
    ctx.font = "500 18px Inter";
    ctx.fillStyle = inkSoft;
    ctx.fillText(k, 40, y);
    
    ctx.fillStyle = ink;
    ctx.font = "600 18px Inter";
    const vw = ctx.measureText(v).width;
    ctx.fillText(v, W - 40 - vw, y);
    y += 42;
  });

  y += 10;
  ctx.strokeStyle = line;
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
  ctx.setLineDash([]);
  y += 36;

  // Footer
  ctx.fillStyle = inkSoft;
  ctx.font = "500 15px 'IBM Plex Mono'";
  ctx.fillText("Generated by Saifullah Tameem · " + new Date().toLocaleString("en-IN"), 40, H - 32);

  $("#receiptTitle").textContent = isPaid ? "Payment receipt" : "Balance statement";
  openSheet("sheetReceipt");
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

$("#btnCloseReceipt").onclick = () => closeSheet("sheetReceipt");

$("#btnDownloadReceipt").onclick = () => {
  const canvas = $("#receiptCanvas");
  const a = document.createElement("a");
  a.download = "receipt-" + Date.now() + ".png";
  a.href = canvas.toDataURL("image/png");
  a.click();
};

$("#btnShareReceipt").onclick = async () => {
  const canvas = $("#receiptCanvas");
  canvas.toBlob(async (blob) => {
    const file = new File([blob], "receipt.png", { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Rent receipt" }); }
      catch (e) { /* user cancelled */ }
    } else {
      const a = document.createElement("a");
      a.download = "receipt.png"; a.href = URL.createObjectURL(blob); a.click();
      toast("Sharing isn't supported here — downloaded instead");
    }
  }, "image/png");
};

// ---------------------------------------------------------
// Tenant filter tabs
// ---------------------------------------------------------
$("#tenantFilter").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  $$("#tenantFilter button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderTenantList(btn.dataset.filter);
});

// ---------------------------------------------------------
// Settings
// ---------------------------------------------------------
$("#btnSettings").onclick = () => switchView("settings");

function loadConfigIntoForm() {
  $("#cfgUrl").value = CONFIG.apiUrl || "";
  $("#cfgKey").value = CONFIG.apiKey || "";
  $("#cfgBiz").value = CONFIG.bizName || "";
  $("#cfgPhone").value = CONFIG.bizPhone || "";
}

$("#btnSaveConfig").onclick = async () => {
  CONFIG = {
    apiUrl: $("#cfgUrl").value.trim(),
    apiKey: $("#cfgKey").value.trim(),
    bizName: $("#cfgBiz").value.trim(),
    bizPhone: $("#cfgPhone").value.trim()
  };
  localStorage.setItem(LS_CONFIG, JSON.stringify(CONFIG));
  toast("Saved. Connecting…");
  await loadData(true);
};

$("#btnRefreshData").onclick = () => loadData(true);

// ---------------------------------------------------------
// Header scroll shadow
// ---------------------------------------------------------
window.addEventListener("scroll", () => {
  $("#appHeader").classList.toggle("scrolled", window.scrollY > 4);
});

// ---------------------------------------------------------
// Service worker
// ---------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
loadConfigIntoForm();
setConnStatus(false);
if (CONFIG.apiUrl && CONFIG.apiKey) {
  loadData();
} else {
  const cached = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
  if (cached) { DATA = cached; renderAll(); }
  switchView("settings");
  toast("Connect your Google Sheet to get started");
}
window.openSheet = openSheet;