// utils/gstCalculator.js

const GST_RATE = 0.18;

function calculateItemGST(item, product) {
    const sellingValue = item.quantity * item.price;

    // New item → normal GST
    if (product.item_condition === 'NEW') {
        return sellingValue * GST_RATE;
    }

    // Pre-Owned item
    if (product.item_condition === 'PRE_OWNED') {
        if (item.gst_method === 'margin') {
            const purchaseValue = product.purchase_price * item.quantity;
            const margin = sellingValue - purchaseValue;
            return margin > 0 ? margin * GST_RATE : 0;
        }
        return sellingValue * GST_RATE;
    }

    return 0;
}

module.exports = {
    calculateItemGST,
    GST_RATE
};
