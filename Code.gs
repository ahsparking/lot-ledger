/**
 * PARKING RENT TRACKER — Backend
 * ------------------------------------------------------------
 * Paste this whole file into Extensions > Apps Script (in your
 * Google Sheet), then follow SETUP.md to deploy it as a Web App.
 * ------------------------------------------------------------
 */

// 1. Set your own secret key here — pick anything, e.g. "chennai-lot-9182"
//    You'll enter the same key inside the app's Settings screen.
var API_KEY = "CHANGE-THIS-SECRET-KEY";

var SHEET_PROPERTIES = "Properties";
var SHEET_TENANTS = "Tenants";
var SHEET_PAYMENTS = "Payments";

// ---------- Setup: run this once from the Apps Script editor ----------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var props = ss.getSheetByName(SHEET_PROPERTIES) || ss.insertSheet(SHEET_PROPERTIES);
  if (props.getLastRow() === 0) {
    props.appendRow(["ID", "Name", "Type"]);
  }

  var tenants = ss.getSheetByName(SHEET_TENANTS) || ss.insertSheet(SHEET_TENANTS);
  if (tenants.getLastRow() === 0) {
    tenants.appendRow(["ID", "PropertyID", "Name", "Phone", "Address", "SpotLabel",
      "VehicleType", "CarCount", "BikeCount", "MonthlyRent", "Advance",
      "RevisedRent", "RevisedFrom", "StartDate", "AgreementEnd",
      "OpeningBalance", "OpeningBalanceDate", "Active"]);
  }

  var payments = ss.getSheetByName(SHEET_PAYMENTS) || ss.insertSheet(SHEET_PAYMENTS);
  if (payments.getLastRow() === 0) {
    payments.appendRow(["ID", "TenantID", "Date", "Amount", "Mode", "Note"]);
  }

  // Remove the default "Sheet1" if it's still empty and unused
  var def = ss.getSheetByName("Sheet1");
  if (def && def.getLastRow() === 0) ss.deleteSheet(def);
}

// ---------- Run this ONCE if you deployed before these fields existed ----------
// It safely adds any missing columns to your existing Tenants sheet without
// touching your current data. Select "migrateAddTenantColumns" from the
// function dropdown above and click Run.
function migrateAddTenantColumns() {
  var sheet = getSheet(SHEET_TENANTS);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var required = ["Address", "VehicleType", "CarCount", "BikeCount", "Advance",
    "RevisedRent", "RevisedFrom", "AgreementEnd", "OpeningBalance", "OpeningBalanceDate"];
  var added = [];
  required.forEach(function (h) {
    if (headers.indexOf(h) === -1) {
      lastCol++;
      sheet.getRange(1, lastCol).setValue(h);
      added.push(h);
    }
  });
  Logger.log(added.length ? "Added columns: " + added.join(", ") : "Nothing to add — already up to date.");
}

// ---------- Web app entry points ----------
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: "Parking Rent Tracker API is running." }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var out;
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.key !== API_KEY) {
      out = { error: "Invalid API key" };
    } else {
      switch (data.action) {
        case "getAll": out = getAllData(); break;
        case "addProperty": out = addProperty(data); break;
        case "addTenant": out = addTenant(data); break;
        case "updateTenant": out = updateTenant(data); break;
        case "addPayment": out = addPayment(data); break;
        case "deletePayment": out = deletePayment(data); break;
        default: out = { error: "Unknown action: " + data.action };
      }
    }
  } catch (err) {
    out = { error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Helpers ----------
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function sheetToObjects(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join("") === "") continue; // skip blank rows
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
      obj[headers[j]] = val;
    }
    rows.push(obj);
  }
  return rows;
}

function nextId(prefix, sheet) {
  return prefix + "-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000);
}

// ---------- Data operations ----------
function getAllData() {
  return {
    properties: sheetToObjects(getSheet(SHEET_PROPERTIES)),
    tenants: sheetToObjects(getSheet(SHEET_TENANTS)),
    payments: sheetToObjects(getSheet(SHEET_PAYMENTS))
  };
}

function addProperty(data) {
  var sheet = getSheet(SHEET_PROPERTIES);
  var id = nextId("P", sheet);
  sheet.appendRow([id, data.name, data.type || ""]);
  return { ok: true, id: id };
}

function addTenant(data) {
  var sheet = getSheet(SHEET_TENANTS);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var id = nextId("T", sheet);
  var values = {
    ID: id,
    PropertyID: data.propertyId,
    Name: data.name,
    Phone: data.phone || "",
    Address: data.address || "",
    SpotLabel: data.spotLabel || "",
    VehicleType: data.vehicleType || "",
    CarCount: data.carCount ? Number(data.carCount) : "",
    BikeCount: data.bikeCount ? Number(data.bikeCount) : "",
    MonthlyRent: Number(data.monthlyRent) || 0,
    Advance: data.advance ? Number(data.advance) : "",
    RevisedRent: data.revisedRent ? Number(data.revisedRent) : "",
    RevisedFrom: data.revisedFrom || "",
    StartDate: data.startDate,
    AgreementEnd: data.agreementEnd || "",
    OpeningBalance: data.openingBalance !== undefined && data.openingBalance !== "" ? Number(data.openingBalance) : "",
    OpeningBalanceDate: data.openingBalanceDate || "",
    Active: true
  };
  var row = headers.map(function (h) {
    return values.hasOwnProperty(h) ? values[h] : "";
  });
  sheet.appendRow(row);
  return { ok: true, id: id };
}

function updateTenant(data) {
  var sheet = getSheet(SHEET_TENANTS);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idCol = headers.indexOf("ID");

  // field name -> how to coerce the incoming value
  var setters = {
    name: { col: "Name", cast: String },
    phone: { col: "Phone", cast: String },
    address: { col: "Address", cast: String },
    spotLabel: { col: "SpotLabel", cast: String },
    vehicleType: { col: "VehicleType", cast: String },
    carCount: { col: "CarCount", cast: Number },
    bikeCount: { col: "BikeCount", cast: Number },
    monthlyRent: { col: "MonthlyRent", cast: Number },
    advance: { col: "Advance", cast: Number },
    revisedRent: { col: "RevisedRent", cast: Number },
    revisedFrom: { col: "RevisedFrom", cast: String },
    agreementEnd: { col: "AgreementEnd", cast: String },
    openingBalance: { col: "OpeningBalance", cast: Number },
    openingBalanceDate: { col: "OpeningBalanceDate", cast: String },
    active: { col: "Active", cast: function (v) { return v; } }
  };

  for (var i = 1; i < values.length; i++) {
    if (values[i][idCol] === data.id) {
      var rowNum = i + 1;
      Object.keys(setters).forEach(function (key) {
        if (data[key] === undefined) return;
        var colIndex = headers.indexOf(setters[key].col);
        if (colIndex === -1) return; // column doesn't exist yet — run migrateAddTenantColumns()
        var raw = data[key];
        var val = raw === "" ? "" : setters[key].cast(raw);
        sheet.getRange(rowNum, colIndex + 1).setValue(val);
      });
      return { ok: true };
    }
  }
  return { error: "Tenant not found" };
}

function addPayment(data) {
  var sheet = getSheet(SHEET_PAYMENTS);
  var id = nextId("PMT", sheet);
  sheet.appendRow([
    id,
    data.tenantId,
    data.date,
    Number(data.amount) || 0,
    data.mode || "",
    data.note || ""
  ]);
  return { ok: true, id: id };
}

function deletePayment(data) {
  var sheet = getSheet(SHEET_PAYMENTS);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === data.id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { error: "Payment not found" };
}
