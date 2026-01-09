console.log("bills-new.js loaded");

// Product select
document.addEventListener("change", function (e) {
    if (e.target.matches("select[name*='[product_id]']")) {
        const row = e.target.closest("tr");
        const selected = e.target.selectedOptions[0];

        const priceInput = row.querySelector("input[name*='[price]']");
        const qtyInput = row.querySelector("input[name*='[quantity]']");

        priceInput.value = selected.dataset.price || 0;
        qtyInput.value = 1;

        calculateRow(row);
        calculateTotals();
    }
});

// Qty / Price / GST change
document.addEventListener("input", function (e) {
    if (
        e.target.matches("input[name*='[quantity]']") ||
        e.target.matches("input[name*='[price]']") ||
        e.target.matches("input[name*='[gst_percent]']")
    ) {
        const row = e.target.closest("tr");
        calculateRow(row);
        calculateTotals();
    }
});

function calculateRow(row) {
    const qty = Number(row.querySelector("input[name*='[quantity]']").value || 0);
    const price = Number(row.querySelector("input[name*='[price]']").value || 0);
    const gstPercent = Number(row.querySelector("input[name*='[gst_percent]']").value || 0);

    const select = row.querySelector("select");
    const stock = Number(select.selectedOptions[0]?.dataset.stock || 0);

    // Stock validation
    if (qty > stock) {
        alert(`Only ${stock} items available`);
        row.querySelector("input[name*='[quantity]']").value = stock;
        return calculateRow(row);
    }

    const subtotal = qty * price;
    const gstAmount = (subtotal * gstPercent) / 100;
    const total = subtotal + gstAmount;

    row.querySelector("input[name*='[total]']").value = total.toFixed(2);
}

function calculateTotals() {
    let subtotal = 0;
    let gstTotal = 0;

    document.querySelectorAll("#itemsTable tbody tr").forEach(row => {
        const qty = Number(row.querySelector("input[name*='[quantity]']").value || 0);
        const price = Number(row.querySelector("input[name*='[price]']").value || 0);
        const gstPercent = Number(row.querySelector("input[name*='[gst_percent]']").value || 0);

        const rowSubtotal = qty * price;
        const rowGst = (rowSubtotal * gstPercent) / 100;

        subtotal += rowSubtotal;
        gstTotal += rowGst;
    });

    const cgst = gstTotal / 2;
    const sgst = gstTotal / 2;

    document.getElementById("subtotal").value = subtotal.toFixed(2);
    document.getElementById("cgst").value = cgst.toFixed(2);
    document.getElementById("sgst").value = sgst.toFixed(2);
    document.getElementById("grandTotal").value = (subtotal + gstTotal).toFixed(2);
}
