console.log("bills-new.js loaded");
function calculateRow(row) {
    const qty = Number(row.querySelector("input[name*='[quantity]']").value || 0);
    const price = Number(row.querySelector("input[name*='[price]']").value || 0);
    const gstPercent = Number(row.querySelector("input[name*='[gst_percent]']").value || 0);

    const stock = Number(row.querySelector("input[name*='[stock]']").value || 0);
    const purchasePrice = Number(row.querySelector("input[name*='[purchase_price]']").value || 0);

    if (qty > stock && stock > 0) {
        alert(`Only ${stock} items available`);
        row.querySelector("input[name*='[quantity]']").value = stock;
        return calculateRow(row);
    }
const taxable = qty * price;


// 🔒 STEP 1.1: get bill type
const billType = billTypeSelect.value;
if (billType === "BILL_OF_SUPPLY") {
    row.querySelector("input[name*='[total]']").value =
        taxable.toFixed(2);
    return;
}

// 🔒 STEP 1.2: read gst method
let gstMethod = row.querySelector(".gst-method")?.value;

// 🔒 STEP 1.3: FORCE RULE
// Margin is allowed ONLY for TAX_INVOICE
if (billType !== "TAX_INVOICE") {
    gstMethod = "normal";
}

let gstAmount = 0;

if (gstMethod === "margin") {
    const margin = (price - purchasePrice) * qty;
    if (margin > 0) {
        gstAmount = (margin * 18) / 100;
    }
} else {
    gstAmount = (taxable * gstPercent) / 100;
}


    const total = taxable + gstAmount;
    row.querySelector("input[name*='[total]']").value = total.toFixed(2);
}


/* =========================
   TOTAL CALCULATION
========================= */
function calculateTotals() {
    let subtotal = 0;
    let totalGSTAmount = 0;

    document.querySelectorAll("#itemsTable tbody tr").forEach(row => {
        const qty = Number(row.querySelector("input[name*='[quantity]']").value || 0);
        const price = Number(row.querySelector("input[name*='[price]']").value || 0);
        const gstPercent = Number(row.querySelector("input[name*='[gst_percent]']").value || 0);

        const purchasePrice = Number(row.querySelector("input[name*='[purchase_price]']").value || 0);

        const rowSubtotal = qty * price;
        subtotal += rowSubtotal;

        // 🔒 BILL OF SUPPLY → NO GST
        if (billTypeSelect.value === "BILL_OF_SUPPLY") return;

        let gstMethod = row.querySelector(".gst-method")?.value;
        let rowGST = 0;

        if (gstMethod === "margin") {
            const margin = (price - purchasePrice) * qty;
            if (margin > 0) {
                rowGST = (margin * 18) / 100;
            }
        } else {
            rowGST = (rowSubtotal * gstPercent) / 100;
        }

        totalGSTAmount += rowGST;
    });

    const isBOS = billTypeSelect.value === "BILL_OF_SUPPLY";

    const cgst = isBOS ? 0 : totalGSTAmount / 2;
    const sgst = isBOS ? 0 : totalGSTAmount / 2;
    const grandTotal = isBOS ? subtotal : subtotal + totalGSTAmount;

    document.getElementById("subtotal").value = subtotal.toFixed(2);
    document.getElementById("cgst").value = cgst.toFixed(2);
    document.getElementById("sgst").value = sgst.toFixed(2);
    document.getElementById("grandTotal").value = grandTotal.toFixed(2);
}

function handleBillTypeUI() {
    const billType = billTypeSelect.value;
    const isTaxInvoice = billType === "TAX_INVOICE";
    const isMemorandum = billType === "MEMORANDUM";
    const isBillOfSupply = billType === "BILL_OF_SUPPLY";

    document.querySelectorAll("#itemsTable tbody tr").forEach(row => {
        const gstInput = row.querySelector("input[name*='[gst_percent]']");
        const gstMethod = row.querySelector(".gst-method");

        if (isBillOfSupply) {
            document.getElementById("cgst").value = "0.00";
            document.getElementById("sgst").value = "0.00";
            // BILL OF SUPPLY: GST not applicable
            if (gstMethod) {
                gstMethod.value = "normal";
                gstMethod.classList.add('invisible-keep-space');
            }

            if (gstInput) {
                gstInput.value = 0;
                gstInput.disabled = true;
            }
        } else if (isMemorandum) {
            // MEMORANDUM: show GST breakup but do NOT allow margin scheme (normal GST only)
            if (gstMethod) {
                gstMethod.value = "normal";
                gstMethod.classList.add('invisible-keep-space');
            }

            if (gstInput) {
                gstInput.disabled = false;
                // if previous value was 0 (e.g., from margin scheme), default to 18
                if (Number(gstInput.value) <= 0) {
                    gstInput.value = 18;
                }
            }
        } else if (isTaxInvoice) {
            // TAX INVOICE: full GST controls
            if (gstInput) {
                gstInput.disabled = false;
                gstInput.value = gstInput.value || 18;
            }

            updateGSTMethodUI(row);
        }

        calculateRow(row);
    });

    calculateTotals();
}


/* =========================
   GLOBAL ELEMENTS
========================= */
const billTypeSelect = document.getElementById("bill_type");

/* =========================
   GST METHOD UI (SINGLE SOURCE OF TRUTH)
========================= */
function updateGSTMethodUI(row) {
    const gstMethod = row.querySelector(".gst-method");
    const gstInput = row.querySelector("input[name*='[gst_percent]']");
    const billType = billTypeSelect.value;

    if (!gstMethod || !gstInput) return;

    const condition = row.querySelector("input[name*='[condition]']").value;

    if (billType === "BILL_OF_SUPPLY") {
        // BILL OF SUPPLY: hide GST method (keep its space) and disable GST input
        gstMethod.classList.add('invisible-keep-space');
        gstMethod.value = "normal";
        gstInput.value = 0;
        gstInput.disabled = true;
        return;
    }

    if (billType === "MEMORANDUM") {
        // MEMORANDUM: show GST input (breakup) but keep method normal (no margin scheme)
        gstInput.disabled = false;
        // if previous value was 0 (e.g., from margin scheme), default to 18
        if (Number(gstInput.value) <= 0) {
            gstInput.value = 18;
        }
        gstMethod.classList.add('invisible-keep-space');
        gstMethod.value = "normal";
        // recalc because GST% may have changed
        calculateRow(row);
        calculateTotals();
        return;
    }

    // TAX_INVOICE behavior
    gstInput.disabled = false;
    if (condition === "PRE_OWNED") {
        gstMethod.classList.remove('invisible-keep-space');
    } else {
        gstMethod.classList.add('invisible-keep-space');
        gstMethod.value = "normal";
    }
}


/* =========================
   PRODUCT SELECTION
========================= */
document.addEventListener("change", function (e) {
    if (!e.target.matches("select[name*='[product_id]']") && 
        !e.target.matches("input[name*='[product_id]']")) return;

    const row = e.target.closest("tr");
    if (!row) return;

    // Handle both select (if used) and hidden input (from autocomplete)
    if (e.target.tagName === "SELECT") {
        const selected = e.target.selectedOptions[0];
        if (!selected) return;
        row.querySelector("input[name*='[price]']").value =
            selected.dataset.price || 0;
    } else if (e.target.matches("input[name*='[product_id]']")) {
        // Product selected from autocomplete - price is already set
        // Just trigger calculations
    }

    updateGSTMethodUI(row);
    calculateRow(row);
    calculateTotals();
});

/* =========================
   INPUT CHANGES
========================= */
document.addEventListener("input", function (e) {
    if (
        e.target.matches("input[name*='[quantity]']") ||
        e.target.matches("input[name*='[price]']") ||
        e.target.matches("input[name*='[gst_percent]']")
    ) {
        const row = e.target.closest("tr");
        if (!row) return;

        calculateRow(row);
        calculateTotals();
    }
});

/* =========================
   GST METHOD CHANGE
========================= */
document.addEventListener("change", function (e) {
    if (!e.target.classList.contains("gst-method")) return;

    const row = e.target.closest("tr");
    const gstInput = row.querySelector("input[name*='[gst_percent]']");

    if (e.target.value === "margin") {
        gstInput.value = 0;
        gstInput.disabled = true;
    } else {
        gstInput.disabled = false;
        gstInput.value = 18;
    }

    calculateRow(row);
    calculateTotals();
});

/* =========================
   ROW CALCULATION
========================= */


/* =========================
   BILL TYPE LOGIC
========================= */


billTypeSelect.addEventListener("change", handleBillTypeUI);
document.addEventListener("DOMContentLoaded", handleBillTypeUI);

const phoneInput = document.getElementById("customer_phone");
const nameInput = document.getElementById("customer_name");
const addressInput = document.getElementById("customer_address");
const gstinInput = document.getElementById("customer_gstin");
const hint = document.getElementById("customerHint");

let searchTimer;

phoneInput.addEventListener("input", () => {
  clearTimeout(searchTimer);

  const phone = phoneInput.value.trim();

  // Reset if phone too short
  if (phone.length < 5) {
    hint.classList.add("d-none");
    return;
  }

  searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/customers/search?phone=${phone}`);
      const customer = await res.json();

      if (customer) {
        nameInput.value = customer.name || "";
        addressInput.value = customer.address || "";
        gstinInput.value = customer.gstin || "";

        hint.classList.remove("d-none");
      } else {
        hint.classList.add("d-none");
      }
    } catch (err) {
      console.error("Customer lookup failed", err);
    }
  }, 400); // debounce
});



