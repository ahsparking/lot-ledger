// Function to clear or populate tenant form fields
$("#btnAddTenantTop").onclick = () => {
  $("#atEditId").textContent = "";
  $("#atName").value = "";
  $("#atPhone").value = "";
  $("#atAddress").value = "";
  $("#atSpot").value = "";
  $("#atAdvance").value = "";
  $("#atFixedRent").value = "";
  $("#atRevisedRent").value = "";
  $("#atRent").value = "";
  $("#atVehicleType").value = "Car";
  $("#atNoCars").value = "1";
  $("#atNoBikes").value = "0";
  $("#atStart").value = todayStr();
  $("#atAgrStart").value = todayStr();
  $("#atAgrEnd").value = "";
  renderPropertyOptions();
  openSheet("sheetAddTenant");
};

// Edit button handler inside Tenant Profile Modal
$("#tpBtnEdit").onclick = () => {
  const t = DATA.tenants.find((x) => x.ID === activeTenantId);
  closeSheet("sheetTenant");
  $("#atEditId").textContent = t.ID;
  $("#atName").value = t.Name || "";
  $("#atPhone").value = t.Phone || "";
  $("#atAddress").value = t.Address || "";
  renderPropertyOptions();
  $("#atProperty").value = t.PropertyID;
  $("#atSpot").value = t.SpotLabel || "";
  $("#atAdvance").value = t.AdvanceAmount || "";
  $("#atFixedRent").value = t.FixedRent || "";
  $("#atRevisedRent").value = t.RevisedRent || "";
  $("#atRent").value = t.MonthlyRent || "";
  $("#atVehicleType").value = t.VehicleType || "Car";
  $("#atNoCars").value = t.NoOfCars || 0;
  $("#atNoBikes").value = t.NoOfBikes || 0;
  $("#atStart").value = t.StartDate || todayStr();
  $("#atAgrStart").value = t.AgreementStartDate || "";
  $("#atAgrEnd").value = t.AgreementEndDate || "";
  openSheet("sheetAddTenant");
};

// Save Tenant button click logic
$("#btnSaveTenant").onclick = async () => {
  const name = $("#atName").value.trim();
  const propertyId = $("#atProperty").value;
  const rent = $("#atRent").value || $("#atRevisedRent").value || $("#atFixedRent").value;
  const start = $("#atStart").value;

  if (!name || !propertyId || !rent || !start) {
    return toast("Fill in required fields: Name, Lot, Rent and Start Date");
  }

  const editId = $("#atEditId").textContent;
  const payload = {
    name,
    phone: $("#atPhone").value.trim(),
    address: $("#atAddress").value.trim(),
    propertyId,
    spotLabel: $("#atSpot").value.trim(),
    advanceAmount: $("#atAdvance").value,
    fixedRent: $("#atFixedRent").value,
    revisedRent: $("#atRevisedRent").value,
    monthlyRent: rent,
    vehicleType: $("#atVehicleType").value,
    noOfCars: $("#atNoCars").value,
    noOfBikes: $("#atNoBikes").value,
    startDate: start,
    agreementStartDate: $("#atAgrStart").value,
    agreementEndDate: $("#atAgrEnd").value
  };

  try {
    if (editId) {
      await api("updateTenant", { id: editId, ...payload });
      toast("Tenant updated");
    } else {
      await api("addTenant", payload);
      toast("Tenant added");
    }
    closeSheet("sheetAddTenant");
    await loadData();
  } catch (e) {
    toast(e.message);
  }
};