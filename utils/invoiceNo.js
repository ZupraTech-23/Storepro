/**
 * Generates year-based invoice numbers
 * Supports TAX_INVOICE, MEMORANDUM, BILL_OF_SUPPLY
 */

async function generateInvoiceNo(conn, billType) {
    const year = new Date().getFullYear();

    let prefix = "INV";
    if (billType === "MEMORANDUM") prefix = "CM";
    if (billType === "BILL_OF_SUPPLY") prefix = "BOS";

    const [[last]] = await conn.query(
        `SELECT invoice_no
         FROM bills
         WHERE bill_type = ?
           AND invoice_no LIKE ?
         ORDER BY id DESC
         LIMIT 1`,
        [billType, `${prefix}/${year}/%`]
    );

    let nextNumber = 1;

    if (last && last.invoice_no) {
        const parts = last.invoice_no.split("/");
        nextNumber = parseInt(parts[2], 10) + 1;
    }

    return `${prefix}/${year}/${String(nextNumber).padStart(4, "0")}`;
}

module.exports = {
    generateInvoiceNo
};
