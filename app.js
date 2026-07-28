/* ==========================================================
   LOT LEDGER — app logic
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
const todayStr = () => new Date().toISOString().slice(0, 10);

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
// Balance computation
// ---------------------------------------------------------
function monthsBetweenInclusive(startStr, endStr) {
  const s = new Date(startStr), e = new Date(endStr);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  return Math.max(months, 0);
}

function dayBefore(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function tenantPayments(tenantId) {
  return DATA.payments.filter((p) => p.TenantID === tenantId)
    .sort((a, b) => new Date(b.Date) - new Date(a.Date));
}

// Rent currently in effect (revised rent if it has kicked in, else fixed rent)
function currentRent(t) {
  if (t.RevisedRent && t.RevisedFrom && new Date(t.RevisedFrom) <= new Date()) {
    return Number(t.RevisedRent);
  }
  return Number(t.MonthlyRent || 0);
}

function firstOfNextMonth(dateStr) {
  const d = new Date(dateStr);
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return n.toISOString().slice(0, 10);
}

function tenantBalance(t) {
  const today = todayStr();
  const endCap = (t.AgreementEnd && t.AgreementEnd < today) ? t.AgreementEnd : today;

  const hasOpening = t.OpeningBalance !== undefined && t.OpeningBalance !== "" && t.OpeningBalanceDate;
  const openingAmt = hasOpening ? Number(t.OpeningBalance) || 0 : 0;
  // Rent only starts accruing from the month AFTER the opening-balance date —
  // that date's "as of" amount already accounts for everything up to then.
  const baselineStart = hasOpening ? firstOfNextMonth(t.OpeningBalanceDate) : t.StartDate;

  let charged = openingAmt;
  if (t.RevisedRent && t.RevisedFrom) {
    const oldMonths = monthsBetweenInclusive(baselineStart, dayBefore(t.RevisedFrom));
    const newMonths = monthsBetweenInclusive(t.RevisedFrom, endCap);
    charged += oldMonths * Number(t.MonthlyRent || 0) + newMonths * Number(t.RevisedRent || 0);
  } else {
    charged += monthsBetweenInclusive(baselineStart, endCap) * Number(t.MonthlyRent || 0);
  }

  // Only count payments logged on/after the opening-balance date, so history
  // already folded into the opening balance isn't subtracted twice.
  let pays = tenantPayments(t.ID);
  if (hasOpening) pays = pays.filter((p) => p.Date >= t.OpeningBalanceDate);
  const paid = pays.reduce((s, p) => s + Number(p.Amount || 0), 0);

  return { charged, paid, balance: charged - paid };
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
  renderTenantList($("#tenantFilter .active")?.dataset.filter || "all");
  renderPayTenantOptions();
}

function renderDashboard() {
  const activeTenants = DATA.tenants.filter((t) => t.Active !== false && t.Active !== "FALSE");
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
    ? (DATA.tenants.length ? "All tenants are settled 🎉" : "Add a tenant to get started")
    : dueCount + " tenant" + (dueCount > 1 ? "s" : "") + " owe rent right now";
  $("#statTenantsDue").textContent = dueCount;
  $("#statCollectedMonth").textContent = fmt(collected30);
  $("#statProperties").textContent = DATA.properties.length;

  // property scroll
  const wrap = $("#propertyScroll");
  wrap.innerHTML = "";
  DATA.properties.forEach((p) => {
    const tenants = DATA.tenants.filter((t) => t.PropertyID === p.ID);
    let due = 0;
    tenants.forEach((t) => { const b = tenantBalance(t).balance; if (b > 0) due += b; });
    const chip = document.createElement("div");
    chip.className = "property-chip";
    chip.innerHTML = `<div class="pc-type">${p.Type || "Lot"}</div>
      <div class="pc-name">${p.Name}</div>
      <div class="pc-amt ${due > 0 ? "" : "clear"} mono">${due > 0 ? fmt(due) + " due" : "All clear"}</div>`;
    chip.onclick = () => { switchView("tenants"); };
    wrap.appendChild(chip);
  });
  if (!DATA.properties.length) {
    wrap.innerHTML = `<div class="empty-state" style="width:100%"><p>No lots yet.</p><button class="btn btn-primary" onclick="openSheet('sheetAddProperty')">+ Add your first lot</button></div>`;
  }

  // due list (top 5)
  const dueListEl = $("#dueList");
  const sorted = activeTenants
    .map((t) => ({ t, b: tenantBalance(t) }))
    .filter((x) => x.b.balance > 0)
    .sort((a, b) => b.b.balance - a.b.balance)
    .slice(0, 5);
  dueListEl.innerHTML = "";
  if (!sorted.length && DATA.tenants.length) {
    dueListEl.innerHTML = `<div class="empty-state"><p>Nobody's pending. Nice work.</p></div>`;
  }
  sorted.forEach(({ t, b }) => dueListEl.appendChild(ticketCard(t, b)));
}

function renderPropertyOptions() {
  const sel = $("#atProperty");
  sel.innerHTML = DATA.properties.map((p) => `<option value="${p.ID}">${p.Name}</option>`).join("") ||
    `<option value="">Add a lot first</option>`;
}

function ticketCard(t, b) {
  const status = b.balance > 0 ? "due" : (b.paid > 0 && b.balance < 0 ? "clear" : "clear");
  const el = document.createElement("div");
  el.className = "ticket";
  el.innerHTML = `
    <div class="ticket-stub"><span class="spot-label">${(t.SpotLabel || "—")}</span></div>
    <div class="ticket-divider"></div>
    <div class="ticket-body">
      <div class="ticket-top">
        <div>
          <div class="ticket-name">${t.Name}</div>
          <div class="ticket-meta">${propertyName(t.PropertyID)}</div>
        </div>
        <div class="ticket-amt ${b.balance > 0 ? "due" : "paid"} mono">${b.balance > 0 ? fmt(b.balance) : (b.balance < 0 ? fmt(b.balance) + " adv" : "₹0")}</div>
      </div>
      <span class="status-pill ${status}">${b.balance > 0 ? "Due" : "Cleared"}</span>
    </div>`;
  el.onclick = () => openTenantProfile(t.ID);
  return el;
}

function renderTenantList(filter) {
  const list = $("#tenantList");
  list.innerHTML = "";
  const byProp = {};
  DATA.tenants.forEach((t) => {
    (byProp[t.PropertyID] = byProp[t.PropertyID] || []).push(t);
  });
  if (!DATA.tenants.length) {
    list.innerHTML = `<div class="empty-state"><p>No tenants added yet.</p><button class="btn btn-primary" onclick="openSheet('sheetAddTenant')">+ Add tenant</button></div>`;
    return;
  }
  Object.keys(byProp).forEach((propId) => {
    let tenants = byProp[propId];
    const filtered = tenants.filter((t) => {
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
      .sort((a, b) => tenantBalance(b).balance - tenantBalance(a).balance)
      .forEach((t) => list.appendChild(ticketCard(t, tenantBalance(t))));
  });
}

function renderPayTenantOptions() {
  const sel = $("#payTenant");
  const prev = sel.value;
  sel.innerHTML = DATA.tenants.map((t) =>
    `<option value="${t.ID}">${t.Name} — ${propertyName(t.PropertyID)} (${t.SpotLabel || "—"})</option>`
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
function switchView(name) {
  currentView = name;
  $$(".view").forEach((v) => v.classList.remove("active"));
  $("#view-" + name).classList.add("active");
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  if (name === "add") {
    $("#payDate").value = todayStr();
    renderPayTenantOptions();
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
  const b = tenantBalance(t);
  $("#tpAvatar").textContent = (t.Name || "?").charAt(0).toUpperCase();
  $("#tpName").textContent = t.Name;
  $("#tpSub").textContent = `${propertyName(t.PropertyID)} · Spot ${t.SpotLabel || "—"} · ${fmt(currentRent(t))}/mo`;
  $("#tpBalance").textContent = b.balance > 0 ? fmt(b.balance) : (b.balance < 0 ? fmt(b.balance) + " advance" : "₹0");
  $("#tpBalance").className = "amt mono " + (b.balance > 0 ? "due" : "clear");
  $("#tpBalanceLbl").textContent = b.balance > 0 ? "pending balance" : "fully settled";

  const details = $("#tpDetails");
  const detailRows = [];
  if (t.Address) detailRows.push(["Address", t.Address]);
  const vehBits = [];
  if (Number(t.CarCount)) vehBits.push(t.CarCount + " car" + (t.CarCount > 1 ? "s" : ""));
  if (Number(t.BikeCount)) vehBits.push(t.BikeCount + " bike" + (t.BikeCount > 1 ? "s" : ""));
  detailRows.push(["Vehicle", (t.VehicleType || "—") + (vehBits.length ? " · " + vehBits.join(", ") : "")]);
  detailRows.push(["Fixed rent", fmt(t.MonthlyRent)]);
  if (t.RevisedRent) detailRows.push(["Revised rent", fmt(t.RevisedRent) + " (from " + t.RevisedFrom + ")"]);
  if (t.Advance) detailRows.push(["Advance held", fmt(t.Advance)]);
  if (t.OpeningBalanceDate) detailRows.push(["Opening balance", fmt(t.OpeningBalance || 0) + " as of " + t.OpeningBalanceDate]);
  detailRows.push(["Agreement", t.StartDate + (t.AgreementEnd ? " → " + t.AgreementEnd : " → ongoing")]);
  details.innerHTML = "";
  detailRows.forEach(([k, v]) => {
    const row = document.createElement("div");
    row.className = "pay-row";
    row.innerHTML = `<div>${k}</div><div class="pr-amt" style="font-family:var(--font-body);font-weight:500">${v}</div>`;
    details.appendChild(row);
  });

  const hist = $("#tpHistory");
  const pays = tenantPayments(id);
  hist.innerHTML = pays.length ? "" : '<div class="helper-text">No payments recorded yet.</div>';
  pays.forEach((p) => {
    const row = document.createElement("div");
    row.className = "pay-row";
    row.innerHTML = `<div><div>${p.Mode || "Payment"}${p.Note ? " · " + p.Note : ""}</div><div class="pr-date">${p.Date}</div></div><div class="pr-amt">${fmt(p.Amount)}</div>`;
    hist.appendChild(row);
  });
  openSheet("sheetTenant");
}

$("#tpBtnRecordPayment").onclick = () => {
  closeSheet("sheetTenant");
  switchView("add");
  $("#payTenant").value = activeTenantId;
  updatePayBalanceBox();
};
$("#tpBtnStatement").onclick = () => {
  const t = DATA.tenants.find((x) => x.ID === activeTenantId);
  generateReceipt({ mode: "statement", tenant: t });
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

$("#btnSaveProperty").onclick = async () => {
  const name = $("#apName").value.trim();
  if (!name) return toast("Enter a lot name");
  try {
    await api("addProperty", { name, type: $("#apType").value });
    toast("Lot added");
    $("#apName").value = "";
    closeSheet("sheetAddProperty");
    await loadData();
  } catch (e) { toast(e.message); }
};

$("#btnSaveTenant").onclick = async () => {
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
};

$("#payTenant").addEventListener("change", updatePayBalanceBox);

$("#btnSavePayment").onclick = async () => {
  const tenantId = $("#payTenant").value;
  const amount = Number($("#payAmount").value);
  const date = $("#payDate").value || todayStr();
  if (!tenantId) return toast("Add a tenant first");
  if (!amount || amount <= 0) return toast("Enter a valid amount");
  try {
    await api("addPayment", { tenantId, amount, date, mode: $("#payMode").value, note: $("#payNote").value });
    await loadData();
    toast("Payment saved");
    const t = DATA.tenants.find((x) => x.ID === tenantId);
    generateReceipt({ mode: "payment", tenant: t, amount, date, payMode: $("#payMode").value, note: $("#payNote").value });
    $("#payAmount").value = ""; $("#payNote").value = "";
    switchView("dashboard");
  } catch (e) { toast(e.message); }
};

// ---------------------------------------------------------
// Receipt / statement image generation (canvas)
// ---------------------------------------------------------
async function generateReceipt({ mode, tenant, amount, date, payMode, note }) {
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
  ctx.arcTo(W, 0, W, 26, 26); ctx.lineTo(W, 210);
  ctx.lineTo(0, 210); ctx.lineTo(0, 26); ctx.arcTo(0, 0, 26, 0, 26);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.font = "600 20px Inter";
  ctx.fillText((CONFIG.bizName || "Lot Ledger"), 40, 60);
  ctx.font = "500 15px Inter";
  if (CONFIG.bizPhone) ctx.fillText(CONFIG.bizPhone, 40, 84);

  ctx.fillStyle = "#fff";
  ctx.font = "600 24px 'Space Grotesk'";
  ctx.fillText(isPaid ? "PAYMENT RECEIPT" : "BALANCE STATEMENT", 40, 130);

  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "500 14px 'IBM Plex Mono'";
  ctx.fillText((isPaid ? "Received on " : "As of ") + (date || todayStr()), 40, 160);

  // status stamp circle
  ctx.save();
  ctx.translate(W - 100, 105);
  ctx.rotate(-0.18);
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.font = "700 15px Inter";
  ctx.textAlign = "center";
  const stampText = isPaid ? (b.balance > 0 ? "PARTIAL" : "PAID") : (b.balance > 0 ? "DUE" : "CLEAR");
  ctx.fillText(stampText, 0, 6);
  ctx.textAlign = "left";
  ctx.restore();

  // perforation dots between header and body
  ctx.fillStyle = cream;
  for (let x = 30; x < W - 20; x += 22) {
    ctx.beginPath(); ctx.arc(x, 210, 7, 0, Math.PI * 2); ctx.fill();
  }

  let y = 250;
  // Big amount
  ctx.fillStyle = ink;
  ctx.font = "500 15px Inter";
  ctx.fillText(isPaid ? "Amount received" : "Total amount due", 40, y);
  y += 44;
  ctx.font = "700 52px 'IBM Plex Mono'";
  ctx.fillStyle = isPaid ? green : (b.balance > 0 ? rust : green);
  ctx.fillText(fmt(isPaid ? amount : Math.max(b.balance, 0)), 40, y);
  y += 40;

  // divider
  ctx.strokeStyle = line; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
  y += 36;

  // detail rows
  const rows = [];
  rows.push(["Tenant", tenant.Name]);
  rows.push(["Lot / spot", `${propertyName(tenant.PropertyID)} · ${tenant.SpotLabel || "—"}`]);
  rows.push(["Monthly rent", fmt(currentRent(tenant))]);
  if (isPaid) {
    rows.push(["Mode", payMode || "—"]);
    if (note) rows.push(["Note", note]);
  }
  rows.push([isPaid ? "Balance after payment" : "Balance", b.balance > 0 ? fmt(b.balance) + " due" : "Settled"]);

  ctx.font = "500 16px Inter";
  rows.forEach(([k, v]) => {
    ctx.fillStyle = inkSoft;
    ctx.fillText(k, 40, y);
    ctx.fillStyle = ink;
    ctx.font = "600 16px Inter";
    const vw = ctx.measureText(v).width;
    ctx.fillText(v, W - 40 - vw, y);
    ctx.font = "500 16px Inter";
    y += 38;
  });

  y += 10;
  ctx.strokeStyle = line;
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
  ctx.setLineDash([]);
  y += 34;

  ctx.fillStyle = inkSoft;
  ctx.font = "500 13px 'IBM Plex Mono'";
  ctx.fillText("Generated by Lot Ledger · " + new Date().toLocaleString("en-IN"), 40, H - 30);

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
