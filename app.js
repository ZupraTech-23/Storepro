const express = require('express');
require("dotenv").config();

const app = express();
const port = 8080;
const mysql = require("mysql2/promise");
const path = require("path");
const { generateInvoiceNo } = require("./utils/invoiceNo.js");
const getPaymentStatus=require('./utils/helper.js');
const getOrCreateCustomer=require('./utils/customerInsert.js');

const methodOverride = require('method-override')
const { calculateItemGST } = require('./utils/gst.js');

const fs = require("fs");
const WrapAsync = require('./utils/wrapasync.js')
const ExpressError = require('./utils/error.js');
const { getHSNByItem } = require("./utils/hsn.js");

app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(async (req, res, next) => {
  try {
    const [[seller]] = await connection.query(
      'SELECT company_name FROM seller'
    );

    res.locals.shopName = seller?.company_name || 'Shop';
    next();
  } catch (err) {
    console.error('Seller load error:', err);
    next();
  }
});

const ejsMate = require('ejs-mate');
const { error } = require('console');
app.engine('ejs', ejsMate)

const connection = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: true


  }
});
(async function checkDB() {
  try {
    const conn = await connection.getConnection();
    console.log("✅ Database connected");
    conn.release();
  } catch (err) {
    console.error(
      "Database not reachable. Check internet or DB server.",

    );
    process.exit(1);
  }
})();


app.listen(port, (req, res) => {
  console.log("working")
});

app.get("/dashboard", async (req, res) => {
  try {

    // Today Sales
    const [todaySales] = await connection.query(`
      SELECT IFNULL(SUM(grand_total),0) AS total
      FROM bills
      WHERE DATE(created_at)=CURDATE()
      AND status='ACTIVE'
    `);

    // Monthly Revenue
    const [monthlyRevenue] = await connection.query(`
      SELECT IFNULL(SUM(grand_total),0) AS total
      FROM bills
      WHERE MONTH(created_at)=MONTH(CURDATE())
      AND YEAR(created_at)=YEAR(CURDATE())
      AND status='ACTIVE'
    `);

    // Today Collection
    const [todayCollection] = await connection.query(`
      SELECT IFNULL(SUM(credit),0) AS total
      FROM customer_ledger
      WHERE DATE(created_at)=CURDATE()
    `);

    // Total Receivable
    const [totalReceivable] = await connection.query(`
      SELECT IFNULL(SUM(balance),0) AS total FROM customers
    `);

    // Inventory Worth
    const [inventoryValue] = await connection.query(`
      SELECT IFNULL(SUM(stock * purchase_price),0) AS total
      FROM inventory
    `);

    // Low Stock
    const [lowStock] = await connection.query(`
      SELECT name, stock FROM inventory WHERE stock <= 5
    `);

    // Top Debtors
    const [topDebtors] = await connection.query(`
      SELECT name, balance FROM customers
      WHERE balance > 0
      ORDER BY balance DESC
      LIMIT 5
    `);

    // Recent Bills
    const [recentBills] = await connection.query(`
      SELECT id, invoice_no, customer_name, grand_total
      FROM bills
      WHERE status='ACTIVE'
      ORDER BY created_at DESC
      LIMIT 5
    `);

    res.render("dashboard", {
      todaySales: todaySales[0].total,
      monthlyRevenue: monthlyRevenue[0].total,
      todayCollection: todayCollection[0].total,
      totalReceivable: totalReceivable[0].total,
      inventoryValue: inventoryValue[0].total,
      lowStock,
      topDebtors,
      recentBills
    });

  } catch (err) {
    console.log(err);
  }
});


app.get("/", (req, res) => {
  res.send("working")
})
app.get("/billing", async (req, res) => {

  const [bills] = await connection.query(`
    SELECT 
      b.*,
      IFNULL(SUM(p.amount), 0) AS paid_amount
    FROM bills b
    LEFT JOIN payments p ON p.bill_id = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `);

  // derive payment status
  bills.forEach(b => {
    if (b.paid_amount >= b.grand_total) {
      b.payment_status = "PAID";
    } else if (b.paid_amount > 0) {
      b.payment_status = "PARTIAL";
    } else {
      b.payment_status = "DUE";
    }
  });

  res.render("billing", { bills });
});

app.get(
  "/inventory",
  WrapAsync(async (req, res) => {
    const q = "SELECT * FROM inventory";
    const [items] = await connection.query(q);



    res.render("inventory.ejs", { items });
  })
);

app.get("/add-inventory", (req, res) => {
  res.render("add-inventory.ejs");
})



app.get("/search/:type", WrapAsync(async (req, res) => {
  const { type } = req.params;
  const q = req.query.q || "";

  const map = {
    item: "name",
    brand: "brand",
    category: "category",
    condition: "item_condition"
  };

  if (!map[type]) return res.json([]);

  const column = map[type];

  let sql;
  let params;

  if (type === "item") {
    // ✅ group by name to avoid duplicates
    sql = `
      SELECT name AS value
      FROM inventory
      WHERE LOWER(name) LIKE ?
      GROUP BY name
      ORDER BY
        CASE
          WHEN LOWER(name) LIKE ? THEN 0
          ELSE 1
        END,
        name
      LIMIT 10
    `;
    params = [
      `%${q.toLowerCase()}%`,
      `${q.toLowerCase()}%`
    ];
  } else {
    // other fields behave normally
    sql = `
      SELECT DISTINCT ${column} AS value
      FROM inventory
      WHERE LOWER(${column}) LIKE ?
      LIMIT 10
    `;
    params = [`%${q.toLowerCase()}%`];
  }

  const [rows] = await connection.query(sql, params);
  res.json(rows.map(r => r.value));
}));



app.post("/add-inventory", WrapAsync(async (req, res) => {

  let {
    name,
    category,
    brand,
    purchase_price,
    selling_price,
    stock,
    item_condition
  } = req.body;

  purchase_price = Number(purchase_price);
  selling_price = Number(selling_price);
  stock = Number(stock);

  if (selling_price < purchase_price) {
    throw new ExpressError(
      "Selling price cannot be lower than purchase price",
      400
    );
  }

  // Smart condition logic
  if (category?.toLowerCase() === "accessories") {
    item_condition = "New";
  } else if (!item_condition) {
    throw new ExpressError("Item condition is required", 400);
  }

  // ✅ UTIL usage
  const hsn = getHSNByItem({
    category,
    name
  });

  if (!hsn) {
    throw new ExpressError(
      "HSN not configured for this category",
      400
    );
  }

  const q = `
    INSERT INTO inventory
    (name, category, brand, hsn, purchase_price, selling_price, stock, item_condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    await connection.query(q, [
      name,
      category,
      brand,
      hsn,
      purchase_price,
      selling_price,
      stock,
      item_condition
    ]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw new ExpressError("Item already exists", 400);
    }
    throw err;
  }

  res.redirect("/inventory");
}));



app.get('/edit-inventory/:id', WrapAsync(async (req, res, next) => {
  let { id } = req.params;
  let q = "select *from inventory where id =?";
  let [result] = await connection.query(q, [id]);
  let item = result[0];
  if (!item) {
    throw new ExpressError("Inventory item not found", 404);
  }




  res.render("edit-inventory.ejs", { item });


}));

app.patch('/edit-inventory/:id', WrapAsync(async (req, res) => {
  let { id } = req.params;
  let { name, category, brand, purchase_price, selling_price, stock, item_condition } = req.body;
  let q = "UPDATE inventory set name=?,category=?,brand=?,purchase_price=?,selling_price=?,stock=?,item_condition=? where id=?";
  await connection.query(q, [name, category, brand, purchase_price, selling_price, stock, item_condition, id]);

  res.redirect('/inventory');




}))

app.delete('/delete-inventory/:id', WrapAsync(async (req, res) => {
  let { id } = req.params;
  let q = "delete from inventory where id =?";
  const [result] = await connection.query(q, [id])
  if (result.affectedRows === 0) {
    throw new ExpressError("Inventory item not found", 404);
  }
  res.redirect("/inventory");

}))


//suggestion route for inventory


// bills
app.get("/bills/new", WrapAsync(async (req, res, next) => {
  const [products] = await connection.query(
    "SELECT id, name, stock, selling_price,purchase_price,item_condition FROM inventory WHERE stock > 0"
  );

  res.render("bills/new", {
    products
  });

}));



app.post("/bills/create", WrapAsync(async (req, res) => {

  const conn = await connection.getConnection();

  try {
    await conn.beginTransaction();

    // 1️⃣ Bill-level data
    const {
      bill_type,
      item_type,
      customer_name,
      customer_address,
      customer_phone,
      customer_gstin,
      items
    } = req.body;
    const customerId = await getOrCreateCustomer(
  conn,
  customer_name,
  customer_phone,
  customer_address,
  customer_gstin
);


    // 2️⃣ Generate invoice number
    const invoiceNo = await generateInvoiceNo(conn, bill_type);

    let backendSubtotal = 0;
    let backendGST = 0;

    // 🔹 TEMP store calculated item data
    const processedItems = [];

    // 3️⃣ FIRST PASS: validate + calculate only
    for (let item of items) {

      const [[product]] = await conn.query(
        `SELECT name, hsn, stock, item_condition, purchase_price
                 FROM inventory WHERE id = ?`,
        [item.product_id]
      );

      if (!product) throw new Error("Invalid product selected");
      if (!product.hsn) throw new Error(`HSN missing for ${product.name}`);
// Applies to ALL bill types (including MEMORANDUM)
if (Number(items.quantity) <= 0) {
  throw new Error(`Invalid quantity for ${product.name}`);
}

if (product.stock - items.quantity < 0) {
  throw new Error(`Insufficient stock for ${product.name}`);
}



      // Safety: New items cannot use margin
      if (product.item_condition === "NEW") {
        item.gst_method = "normal";
      }

      const baseTotal = Number(item.quantity) * Number(item.price);
      backendSubtotal += baseTotal;

      let itemGST = 0;

      if (bill_type === "TAX_INVOICE") {
        itemGST = calculateItemGST(item, product);
        backendGST += itemGST;
      }


      processedItems.push({
        product_id: item.product_id,
        product_name: product.name,
        hsn: product.hsn,
        quantity: item.quantity,
        price: item.price,
        gst_percent: item.gst_percent || 18,
        gst_method: item.gst_method || "normal",
        total: baseTotal + itemGST
      });
    }

    // 4️⃣ Insert BILL (now totals are final)
    const cgstAmount = bill_type === "TAX_INVOICE" ? backendGST / 2 : 0;
    const sgstAmount = bill_type === "TAX_INVOICE" ? backendGST / 2 : 0;

    const grandTotalCalc = bill_type === "TAX_INVOICE" ? backendSubtotal + backendGST:backendSubtotal;


    const [billResult] = await conn.query(
      `INSERT INTO bills
            (invoice_no, bill_type, customer_id,
             customer_name, customer_address,
             customer_phone, customer_gstin,
             subtotal, cgst, sgst, gst_percent, grand_total)
            VALUES (?, ?, ?, ?,?, ?, ?, ?, ?, ?, ?,  ?)`,
      [
        invoiceNo,
        bill_type,
        customerId,

        customer_name,
        customer_address,
        customer_phone,
        customer_gstin,
        backendSubtotal,
        cgstAmount,
        sgstAmount,
        18,
        grandTotalCalc
      ]
    );

    const billId = billResult.insertId;

    // 5️⃣ SECOND PASS: insert bill_items + update stock
    for (let item of processedItems) {

      await conn.query(
        `INSERT INTO bill_items
                (bill_id, product_name, hsn, quantity, price, gst_percent, gst_method, total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          billId,
          item.product_name,
          item.hsn,
          item.quantity,
          item.price,
          item.gst_percent,
          item.gst_method,
          item.total
        ]
      );


      await conn.query(
        "UPDATE inventory SET stock = stock - ? WHERE id = ?",
        [item.quantity, item.product_id]
      );

    }

    // 🔹 Ledger: BILL (Debit)
const [[cust]] = await conn.query(
  `SELECT balance FROM customers WHERE id=?`,
  [customerId]
);

const balanceAfterBill = Number(cust.balance) + Number(grandTotalCalc);

await conn.query(
  `INSERT INTO customer_ledger
   (customer_id, ref_type, ref_id, bill_id, debit, balance_after)
   VALUES (?, 'BILL', ?, ?, ?, ?)`,
  [
    customerId,
    billId,          // ref_id
    billId,          // bill_id ✅
    grandTotalCalc,
    balanceAfterBill
  ]
);


// 🔹 Update customer balance
await conn.query(
  `UPDATE customers SET balance=? WHERE id=?`,
  [balanceAfterBill, customerId]
);


    // 6️⃣ Commit
    await conn.commit();

    res.redirect(`/bills/${billId}`);

  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send(err.message);
  } finally {
    conn.release();
  }
}));



app.get("/bills/:id", WrapAsync(async (req, res) => {
  const { id } = req.params;

  // 1️⃣ Get bill
  const [[bill]] = await connection.query(
    "SELECT * FROM bills WHERE id = ?",
    [id]
  );

  if (!bill) {
    return res.status(404).send("Bill not found");
  }

  // 2️⃣ Get bill items
  const [items] = await connection.query(
    "SELECT * FROM bill_items WHERE bill_id = ?",
    [id]
  );

  // 3️⃣ Get seller details
  const [[seller]] = await connection.query(
    "SELECT * FROM seller LIMIT 1"
  );

  // 4️⃣ CALCULATE PAYMENT STATUS (🔑 THIS WAS MISSING)
  const [[pay]] = await connection.query(
    "SELECT IFNULL(SUM(amount),0) AS paid FROM payments WHERE bill_id = ?",
    [id]
  );

  const paidAmount = Number(pay.paid);

  let payment_status = "DUE";
  if (paidAmount >= bill.grand_total) {
    payment_status = "PAID";
  } else if (paidAmount > 0) {
    payment_status = "PARTIAL";
  }

  // ✅ RENDER BASED ON BILL TYPE
  if (bill.bill_type === "MEMORANDUM") {
    return res.render("bills/show-memo", {
      bill,
      items,
      seller
      // memo does not need payment_status
    });
  }

  else if (bill.bill_type === "BILL_OF_SUPPLY") {
    return res.render("bills/bos.ejs", {
      bill,
      items,
      seller
      // bos does not need payment_status
    });
  }  
  else {
    // Tax Invoice
    return res.render("bills/show.ejs", {
      bill,
      items,
      seller,
      payment_status   // ✅ NOW EJS WON’T CRASH
    });
  }
}));


app.get("/bills/:id/payments", WrapAsync(async (req, res) => {
  const { id } = req.params;
  const { returnTo } = req.query;

  // 1️⃣ Get bill
  const [[bill]] = await connection.query(
    "SELECT * FROM bills WHERE id = ?",
    [id]
  );

  if (!bill) return res.status(404).send("Bill not found");

  // 2️⃣ Get customer linked to bill
  const [[customer]] = await connection.query(
    "SELECT * FROM customers WHERE id = ?",
    [bill.customer_id]
  );

  // 3️⃣ Get payments
  const [payments] = await connection.query(
    "SELECT * FROM payments WHERE bill_id = ? ORDER BY payment_date",
    [id]
  );

  // 4️⃣ Calculate totals
  const paidAmount = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = bill.grand_total - paidAmount;

  // 5️⃣ Render SAME EJS
  res.render("bills/payment.ejs", {
    bill,        // ALWAYS pass
    customer,    // REQUIRED
    payments,
    paidAmount,
    balance,
    returnTo: returnTo || null     // Pass returnTo to the view (null if not provided)
  });
}));

app.post("/bills/:id/payments", WrapAsync(async (req, res) => {
  const conn = await connection.getConnection();

  try {
    await conn.beginTransaction();

    const { id } = req.params; // bill_id
    const { amount, mode, reference_no, payment_date, notes, returnTo } = req.body;

    // 1️⃣ Get customer linked to bill
    const [[bill]] = await conn.query(
      "SELECT customer_id FROM bills WHERE id = ?",
      [id]
    );

    if (!bill || !bill.customer_id) {
      throw new Error("Customer not linked to this bill");
    }

    const customerId = bill.customer_id;

    // 2️⃣ Insert payment (your table, unchanged)
    const [paymentResult] = await conn.query(
      `INSERT INTO payments
       (bill_id, customer_id, amount, mode, reference_no, payment_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        customerId,
        amount,
        mode,
        reference_no || null,
        payment_date,
        notes || null
      ]
    );

    const paymentId = paymentResult.insertId;

    // 3️⃣ Get current customer balance
    const [[cust]] = await conn.query(
      "SELECT balance FROM customers WHERE id = ?",
      [customerId]
    );

    const balanceAfterPayment =
      Number(cust.balance) - Number(amount);

    // 4️⃣ Ledger CREDIT entry
    // 4️⃣ Ledger CREDIT entry (FIXED)
await conn.query(
  `INSERT INTO customer_ledger
   (customer_id, ref_type, ref_id, bill_id, credit, balance_after)
   VALUES (?, 'PAYMENT', ?, ?, ?, ?)`,
  [
    customerId,
    paymentId,        // ref_id → payment.id
    id,               // bill_id → bill.id (from params)
    amount,
    balanceAfterPayment
  ]
);

    // 5️⃣ Update customer balance
    await conn.query(
      "UPDATE customers SET balance = ? WHERE id = ?",
      [balanceAfterPayment, customerId]
    );

    await conn.commit();
    
    // 6️⃣ Redirect based on returnTo
    if (returnTo) {
      res.redirect(returnTo);
    } else {
      res.redirect(`/bills/${id}`);
    }

  } catch (err) {
    await conn.rollback();
    console.error(err);
    throw err;
  } finally {
    conn.release();
  }
}));


app.get("/bills/:id/edit", WrapAsync(async (req, res) => {
  const { id } = req.params;

  // 1. Fetch bill
  const [[bill]] = await connection.query(
    "SELECT * FROM bills WHERE id = ?",
    [id]
  );

  if (!bill) {
    req.flash("error", "Bill not found");
    return res.redirect("/bills");
  }

  // 2. Fetch bill items + inventory data (JOIN by name)
  const [items] = await connection.query(
    `SELECT 
       bi.*,
       i.id AS product_id,
       i.stock,
       i.purchase_price,
       i.item_condition
     FROM bill_items bi
     JOIN inventory i ON i.name = bi.product_name
     WHERE bi.bill_id = ?`,
    [id]
  );

  // 3. Fetch inventory for autocomplete
  const [products] = await connection.query(
    "SELECT id, name, stock, selling_price, purchase_price, item_condition FROM inventory"
  );

  res.render("bills/edit", {
    bill,
    items,
    products
  });
}));


app.post("/bills/:id/update", WrapAsync(async (req, res) => {
  const { id } = req.params;
  const { bill_type, customer_name, customer_address, customer_phone, customer_gstin, items } = req.body;

  const conn = await connection.getConnection();

  try {
    await conn.beginTransaction();
    /* =========================
   🔹 FETCH OLD BILL (FOR LEDGER)
========================== */
const [[oldBill]] = await conn.query(
  `SELECT customer_id, grand_total, status
   FROM bills WHERE id = ?`,
  [id]
);

if (!oldBill) throw new Error("Bill not found");

if (oldBill.status === "CANCELLED") {
  throw new Error("Cannot edit a cancelled bill");
}


    /* =========================
       1️⃣ FETCH OLD BILL ITEMS
       (for stock restore)
    ========================== */
    const [oldItems] = await conn.query(
      "SELECT product_name, hsn, quantity FROM bill_items WHERE bill_id = ?",
      [id]
    );

    /* =========================
       2️⃣ RESTORE OLD STOCK
    ========================== */
    for (const old of oldItems) {
      await conn.query(
        "UPDATE inventory SET stock = stock + ? WHERE name = ? AND hsn = ?",
        [old.quantity, old.product_name, old.hsn]
      );
    }
  if (Number(items.quantity) <= 0) {
  throw new Error(`Invalid quantity for ${product.name}`);
}

if (oldItems.stock - items.quantity < 0) {
  throw new Error(`Insufficient stock for ${product.name}`);
}


    /* =========================
       3️⃣ DELETE OLD BILL ITEMS
    ========================== */
    await conn.query(
      "DELETE FROM bill_items WHERE bill_id = ?",
      [id]
    );

    /* =========================
       4️⃣ RECALCULATE TOTALS (BACKEND SAFE)
    ========================== */
    let backendSubtotal = 0;
    let backendGST = 0;

    const processedItems = [];

    for (let item of items) {

      const [[product]] = await conn.query(
        `SELECT id, name, hsn, stock, item_condition, purchase_price
         FROM inventory WHERE id = ?`,
        [item.product_id]
      );

      if (!product) throw new Error("Invalid product selected");
      if (!product.hsn) throw new Error(`HSN missing for ${product.name}`);

      if (bill_type !== "MEMORANDUM" && product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      // Safety: NEW items cannot use margin
      if (product.item_condition === "NEW") {
        item.gst_method = "normal";
      }

      const baseTotal = Number(item.quantity) * Number(item.price);
      backendSubtotal += baseTotal;

      let itemGST = 0;
      if (bill_type === "TAX_INVOICE") {
        itemGST = calculateItemGST(item, product);
        backendGST += itemGST;
      }

      processedItems.push({
        product_id: product.id,
        product_name: product.name,
        hsn: product.hsn,
        quantity: item.quantity,
        price: item.price,
        gst_percent: item.gst_percent || 18,
        gst_method: item.gst_method || "normal",
        total: baseTotal + itemGST
      });
    }

    /* =========================
       5️⃣ UPDATE BILL HEADER
    ========================== */
    const cgstAmount = bill_type === "TAX_INVOICE" ? backendGST / 2 : 0;
    const sgstAmount = bill_type === "TAX_INVOICE" ? backendGST / 2 : 0;
    const grandTotal = bill_type === "TAX_INVOICE"
      ? backendSubtotal + backendGST
      : backendSubtotal;

    await conn.query(
      `UPDATE bills SET
        bill_type = ?,
        customer_name = ?,
        customer_address = ?,
        customer_phone = ?,
        customer_gstin = ?,
        subtotal = ?,
        cgst = ?,
        sgst = ?,
        grand_total = ?
       WHERE id = ?`,
      [
        bill_type,
        customer_name,
        customer_address,
        customer_phone,
        customer_gstin,
        backendSubtotal,
        cgstAmount,
        sgstAmount,
        grandTotal,
        id
      ]
    );
    /* =========================
   🔹 LEDGER ADJUSTMENT
========================== */
const difference =
  Number(grandTotal) - Number(oldBill.grand_total);

if (difference !== 0) {

  const [[cust]] = await conn.query(
    "SELECT balance FROM customers WHERE id = ?",
    [oldBill.customer_id]
  );

  let balanceAfter;
  let debit = 0;
  let credit = 0;

  if (difference > 0) {
    // Bill increased → customer owes more
    debit = difference;
    balanceAfter = Number(cust.balance) + difference;
  } else {
    // Bill decreased → customer owes less
    credit = Math.abs(difference);
    balanceAfter = Number(cust.balance) - Math.abs(difference);
  }

  await conn.query(
    `INSERT INTO customer_ledger
     (customer_id, ref_type, ref_id, debit, credit, balance_after)
     VALUES (?, 'BILL', ?, ?, ?, ?)`,
    [
      oldBill.customer_id,
      id,
      debit,
      credit,
      balanceAfter
    ]
  );

  await conn.query(
    "UPDATE customers SET balance = ? WHERE id = ?",
    [balanceAfter, oldBill.customer_id]
  );
}


    /* =========================
       6️⃣ INSERT NEW ITEMS + REDUCE STOCK
    ========================== */
    for (const item of processedItems) {

      await conn.query(
        `INSERT INTO bill_items
         (bill_id, product_name, hsn, quantity, price, gst_percent, gst_method, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          item.product_name,
          item.hsn,
          item.quantity,
          item.price,
          item.gst_percent,
          item.gst_method,
          item.total
        ]
      );

      await conn.query(
        "UPDATE inventory SET stock = stock - ? WHERE id = ?",
        [item.quantity, item.product_id]
      );
    }

    await conn.commit();
    // req.flash("success", "Bill updated successfully & stock reconciled");
    res.redirect(`/bills/${id}`);

  } catch (err) {
    await conn.rollback();
    console.error(err);
    // req.flash("error", err.message);
    res.redirect(`/bills/${id}/edit`);
  } finally {
    conn.release();
  }
}));
app.post("/bills/:id/cancel", WrapAsync(async (req, res) => {
  const { id } = req.params;
  const conn = await connection.getConnection();

  try {
    await conn.beginTransaction();

    /* =========================
       1️⃣ FETCH BILL
    ========================== */
    const [[bill]] = await conn.query(
      "SELECT * FROM bills WHERE id = ?",
      [id]
    );

    if (!bill) throw new Error("Bill not found");
    if (bill.status === "CANCELLED") {
      throw new Error("Bill already cancelled");
    }

    const customerId = bill.customer_id;
    const billAmount = Number(bill.grand_total);

    /* =========================
       2️⃣ FETCH PAYMENTS
    ========================== */
    const [payments] = await conn.query(
      "SELECT * FROM payments WHERE bill_id = ?",
      [id]
    );

    /* =========================
       3️⃣ FETCH CUSTOMER BALANCE
    ========================== */
    const [[cust]] = await conn.query(
      "SELECT balance FROM customers WHERE id = ?",
      [customerId]
    );

    let balance = Number(cust.balance);

    /* =========================
       4️⃣ REVERSE BILL DEBIT
    ========================== */
    balance -= billAmount;

    await conn.query(
      `
      INSERT INTO customer_ledger
      (customer_id, ref_type, ref_id, credit, balance_after)
      VALUES (?, 'BILL_CANCELLED', ?, ?, ?)
      `,
      [customerId, bill.id, billAmount, balance]
    );

    /* =========================
       5️⃣ REVERSE EACH PAYMENT
    ========================== */
    for (const p of payments) {
      balance += Number(p.amount);

      await conn.query(
  `
  INSERT INTO customer_ledger
  (customer_id, ref_type, ref_id, bill_id, credit, balance_after)
  VALUES (?, 'BILL_CANCELLED', ?, ?, ?, ?)
  `,
  [
    customerId,
    bill.id,     // ref_id → bill id
    bill.id,     // bill_id ✅
    billAmount,  // credit amount
    balance
  ]
);

    }

    /* =========================
       6️⃣ UPDATE CUSTOMER BALANCE
    ========================== */
    await conn.query(
      "UPDATE customers SET balance = ? WHERE id = ?",
      [balance, customerId]
    );

    /* =========================
       7️⃣ DELETE PAYMENTS
    ========================== */
    await conn.query(
      "DELETE FROM payments WHERE bill_id = ?",
      [id]
    );

    /* =========================
       8️⃣ RESTORE STOCK
    ========================== */
    const [items] = await conn.query(
      "SELECT product_name, hsn, quantity FROM bill_items WHERE bill_id = ?",
      [id]
    );

    for (const item of items) {
      await conn.query(
        "UPDATE inventory SET stock = stock + ? WHERE name = ? AND hsn = ?",
        [item.quantity, item.product_name, item.hsn]
      );
    }

    /* =========================
       9️⃣ MARK BILL CANCELLED
    ========================== */
    await conn.query(
      "UPDATE bills SET status = 'CANCELLED' WHERE id = ?",
      [id]
    );

    await conn.commit();
    res.redirect("/billing");

  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.redirect("/bills");
  } finally {
    conn.release();
  }
}));

app.post("/bills/:bid/payments/:id/delete", WrapAsync(async (req, res) => {
  const { id, bid } = req.params;
  const { returnTo } = req.body;

  const conn = await connection.getConnection();

  try {
    await conn.beginTransaction();

    // 1️⃣ Fetch payment + customer + bill status
    const [[payment]] = await conn.query(
      `SELECT 
         p.id,
         p.amount,
         p.customer_id,
         p.bill_id,
         b.status
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
       WHERE p.id = ?`,
      [id]
    );

    if (!payment) throw new Error("Payment not found");

    if (payment.status === 'CANCELLED') {
      throw new Error("Cannot delete payment of a cancelled bill");
    }

    const customerId = payment.customer_id;
    const amount = payment.amount;

    // 2️⃣ Get current customer balance
    const [[cust]] = await conn.query(
      "SELECT balance FROM customers WHERE id = ?",
      [customerId]
    );

    const balanceAfterReversal =
      Number(cust.balance) + Number(amount);

    // 3️⃣ Ledger REVERSAL (DEBIT)
   await conn.query(
  `
  INSERT INTO customer_ledger
  (customer_id, ref_type, ref_id, bill_id, debit, balance_after)
  VALUES (?, 'PAYMENT_REVERSAL', ?, ?, ?, ?)
  `,
  [
    customerId,
    payment.id,        // ref_id → payment.id
    payment.bill_id,   // bill_id ✅ (CRITICAL)
    amount,
    balanceAfterReversal
  ]
);



    // 4️⃣ Update customer balance
    await conn.query(
      "UPDATE customers SET balance = ? WHERE id = ?",
      [balanceAfterReversal, customerId]
    );

    // 5️⃣ Delete payment
    await conn.query(
      "DELETE FROM payments WHERE id = ?",
      [id]
    );

    await conn.commit();
    
    // 6️⃣ Redirect based on returnTo
    if (returnTo) {
      res.redirect(returnTo);
    } else {
      res.redirect(`/bills/${bid}`);
    }

  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.redirect("back");
  } finally {
    conn.release();
  }
}));

//customers get
app.get("/customers", WrapAsync(async (req, res) => {

  const [customers] = await connection.query(`
    SELECT 
      c.id,
      c.name,
      c.phone,
      c.balance,
      MAX(l.created_at) AS last_activity
    FROM customers c
    LEFT JOIN customer_ledger l ON l.customer_id = c.id
    GROUP BY c.id
    ORDER BY last_activity DESC
  `);

  res.render("customers/index", { customers });
}));

app.get("/customers/search", WrapAsync(async (req, res) => {
  const { phone } = req.query;

  // Safety checks
  if (!phone || phone.length < 5) {
    return res.json(null);
  }

  const [[customer]] = await connection.query(
    `SELECT name, phone, address, customer_gstin
     FROM customers
     WHERE phone = ?
     LIMIT 1`,
    [phone]
  );

  res.json(customer || null);
}));

app.get("/customers/:id", WrapAsync(async (req, res) => {
  const { id } = req.params;

  const [[customer]] = await connection.query(
    "SELECT * FROM customers WHERE id = ?",
    [id]
  );
  const [invoices] = await connection.query(
  `
  SELECT 
    b.*,
    IFNULL(SUM(p.amount), 0) AS paid_amount
  FROM bills b
  LEFT JOIN payments p ON p.bill_id = b.id
  WHERE b.customer_id = ?
  GROUP BY b.id
  ORDER BY b.created_at DESC
  `,
  [id]
);

// derive payment_status (SAME AS /billing)
invoices.forEach(inv => {
  if (inv.status === 'CANCELLED') {
    inv.payment_status = 'CANCELLED';
  } else if (inv.paid_amount >= inv.grand_total) {
    inv.payment_status = 'PAID';
  } else if (inv.paid_amount > 0) {
    inv.payment_status = 'PARTIAL';
  } else {
    inv.payment_status = 'DUE';
  }
});



  if (!customer) {
    return res.redirect("/customers");
  }

const [ledger] = await connection.query(
  `
  SELECT 
    cl.*,
    COALESCE(b1.invoice_no, b2.invoice_no, b4.invoice_no, b3.invoice_no) AS invoice_no
  FROM customer_ledger cl

  -- BILL & BILL_CANCELLED
  LEFT JOIN bills b1
    ON cl.ref_type IN ('BILL', 'BILL_CANCELLED')
    AND cl.ref_id = b1.id

  -- PAYMENT & PAYMENT_REVERSAL via payments
  LEFT JOIN payments p
    ON cl.ref_type IN ('PAYMENT', 'PAYMENT_REVERSAL')
    AND cl.ref_id = p.id

  LEFT JOIN bills b2
    ON p.bill_id = b2.id

  -- PAYMENT direct via bill_id (backup for deleted payments)
  LEFT JOIN bills b4
    ON cl.ref_type = 'PAYMENT'
    AND cl.bill_id = b4.id

  -- PAYMENT_REVERSAL direct via bill_id (backup)
  LEFT JOIN bills b3
    ON cl.ref_type = 'PAYMENT_REVERSAL'
    AND cl.bill_id = b3.id

  WHERE cl.customer_id = ?
  ORDER BY cl.created_at ASC
  `,
  [id]
);



  res.render("customers/show", {
    customer,
    ledger,
    invoices
  });
}));

app.get('/reports/sales', async (req, res) => {
  try {
    let { from, to } = req.query;

    // ✅ default to today
    const today = new Date().toISOString().split('T')[0];
    if (!from || !to) {
      from = today;
      to = today;
    }

    const [[summary]] = await connection.query(`
      SELECT
        COUNT(*) AS total_bills,
        IFNULL(SUM(grand_total), 0) AS total_sales,
        IFNULL(SUM(cgst + sgst + igst), 0) AS total_gst
      FROM bills
      WHERE status = 'ACTIVE'
      AND DATE(created_at) BETWEEN ? AND ?
    `, [from, to]);

    const [bills] = await connection.query(`
      SELECT
      id,
        invoice_no,
        bill_type,
        customer_name,
        grand_total,
        DATE_FORMAT(created_at, '%d %b %Y') AS bill_date
      FROM bills
      WHERE status = 'ACTIVE'
      AND DATE(created_at) BETWEEN ? AND ?
      ORDER BY created_at DESC
    `, [from, to]);

    res.render('reports/sales', {
      from,
      to,
      summary,
      bills
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Sales report error');
  }
});

app.get('/reports/dues', async (req, res) => {
  try {
    let { from, to } = req.query;

    // default = today
    const today = new Date().toISOString().split('T')[0];
    if (!from || !to) {
      from = today;
      to = today;
    }

    const [rows] = await connection.query(`
      SELECT
        id,
        name,
        phone,
        balance
      FROM customers
      WHERE balance > 0
      ORDER BY balance DESC
    `);

    res.render('reports/dues', {
      customers: rows,
      from,
      to
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Due report error');
  }
});

app.get('/reports/payments', async (req, res) => {
  try {
    let { from, to } = req.query;

    // default to today
    const today = new Date().toISOString().split('T')[0];
    if (!from || !to) {
      from = today;
      to = today;
    }
    

    const [payments] = await connection.query(`
      SELECT
  p.id,
  p.bill_id,      
  p.amount,
  p.mode,
  p.payment_date,
  c.name AS customer_name,
  b.invoice_no
FROM payments p
JOIN customers c ON p.customer_id = c.id
LEFT JOIN bills b ON p.bill_id = b.id
WHERE p.payment_date BETWEEN ? AND ?
ORDER BY p.payment_date DESC, p.id DESC
    `, [from, to]);

    const [[summary]] = await connection.query(`
      SELECT
        IFNULL(SUM(amount),0) AS total_received
      FROM payments
      WHERE payment_date BETWEEN ? AND ?
    `, [from, to]);

    res.render('reports/payments', {
      from,
      to,
      payments,
      summary
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Payment report error');
  }
});

app.get('/reports/stock', async (req, res) => {
  try {
    let { from, to } = req.query;

    // default = today
    const today = new Date().toISOString().split('T')[0];
    if (!from || !to) {
      from = today;
      to = today;
    }

    const [items] = await connection.query(`
      SELECT
        id,
        name,
        category,
        brand,
        purchase_price,
        selling_price,
        stock,
        item_condition,
        (stock * selling_price) AS stock_value
      FROM inventory
      ORDER BY name
    `);

    const summary = {
      total_items: items.length,
      total_stock: items.reduce((sum, i) => sum + i.stock, 0),
      total_stock_value: items.reduce(
        (sum, i) => sum + Number(i.stock_value), 0
      )
    };

    res.render('reports/stock', {
      items,
      summary,
      from,
      to
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Stock report error');
  }
});

app.get('/reports/profit', async (req, res) => {
  try {
    let { from, to } = req.query;

    // default = today
    const today = new Date().toISOString().split('T')[0];
    if (!from || !to) {
      from = today;
      to = today;
    }

    const [rows] = await connection.query(`
      SELECT
        bi.quantity,
        bi.price AS selling_price,
        i.purchase_price,
        (bi.quantity * bi.price) AS sales_value,
        (bi.quantity * i.purchase_price) AS purchase_value,
        ((bi.quantity * bi.price) - (bi.quantity * i.purchase_price)) AS profit
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN inventory i ON bi.product_name = i.name
      WHERE b.status = 'ACTIVE'
      AND DATE(b.created_at) BETWEEN ? AND ?
    `, [from, to]);

    const summary = rows.reduce((acc, r) => {
      acc.sales += Number(r.sales_value);
      acc.purchase += Number(r.purchase_value);
      acc.profit += Number(r.profit);
      return acc;
    }, { sales: 0, purchase: 0, profit: 0 });

   res.render('reports/profit', {
  from,
  to,
  summary
});


  } catch (err) {
    console.error(err);
    res.status(500).send('Profit report error');
  }
});

app.get('/reports/gst-summary', async (req, res) => {
  try {
    let { from, to } = req.query;

    // default = today
    const today = new Date().toISOString().split('T')[0];
    if (!from || !to) {
      from = today;
      to = today;
    }

    const [[raw]] = await connection.query(`
      SELECT
        IFNULL(SUM(cgst), 0) AS total_cgst,
        IFNULL(SUM(sgst), 0) AS total_sgst,
        IFNULL(SUM(igst), 0) AS total_igst,
        IFNULL(SUM(grand_total - (cgst + sgst + igst)), 0) AS taxable_turnover
      FROM bills
      WHERE status = 'ACTIVE'
      AND DATE(created_at) BETWEEN ? AND ?
    `, [from, to]);

    // ✅ convert ALL values to numbers (IMPORTANT)
    const gst = {
      total_cgst: Number(raw.total_cgst),
      total_sgst: Number(raw.total_sgst),
      total_igst: Number(raw.total_igst),
      taxable_turnover: Number(raw.taxable_turnover)
    };

    const total_gst =
      gst.total_cgst +
      gst.total_sgst +
      gst.total_igst;

    res.render('reports/gst-summary', {
      from,
      to,
      gst,
      total_gst
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('GST summary error');
  }
});


app.get('/reports', (req, res) => {
  res.render('reports/index');
});






app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message =
    err.sqlMessage ||
    err.message ||
    "Something occurred";

  res.status(status).send(message);
});








