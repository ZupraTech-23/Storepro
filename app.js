const express = require('express');
require("dotenv").config();

const app = express();
const port = 8080;
const mysql = require("mysql2/promise");
const path = require("path");
const { generateInvoiceNo } = require("./utils/invoiceNo.js");
const getPaymentStatus=require('./utils/helper.js');

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

app.get("/dashboard", (req, res) => {
  res.render("dashboard")
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

}))



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
            (invoice_no, bill_type, 
             customer_name, customer_address,
             customer_phone, customer_gstin,
             subtotal, cgst, sgst, gst_percent, grand_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?)`,
      [
        invoiceNo,
        bill_type,

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

  const [[bill]] = await connection.query(
    "SELECT * FROM bills WHERE id = ?",
    [id]
  );
  if (!bill) return res.status(404).send("Bill not found");

  const [payments] = await connection.query(
    "SELECT * FROM payments WHERE bill_id = ? ORDER BY payment_date",
    [id]
  );

  const paidAmount = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = bill.grand_total - paidAmount;

  res.render("bills/payment.ejs", {
    bill,
    payments,
    paidAmount,
    balance
  });
}));
app.post("/bills/:id/payments", WrapAsync(async (req, res) => {
  const { id } = req.params;
  const { amount, mode, reference_no, payment_date, notes } = req.body;

  await connection.query(
    `INSERT INTO payments
     (bill_id, amount, mode, reference_no, payment_date, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, amount, mode, reference_no || null, payment_date, notes]
  );

  res.redirect(`/bills/${id}/payments`);
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
      "SELECT status FROM bills WHERE id = ?",
      [id]
    );

    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.status === "CANCELLED") {
      throw new Error("Bill already cancelled");
    }

    /* =========================
       2️⃣ FETCH BILL ITEMS
    ========================== */
    const [items] = await conn.query(
      "SELECT product_name, hsn, quantity FROM bill_items WHERE bill_id = ?",
      [id]
    );

    /* =========================
       3️⃣ RESTORE STOCK
    ========================== */
    for (const item of items) {
      await conn.query(
        "UPDATE inventory SET stock = stock + ? WHERE name = ? AND hsn = ?",
        [item.quantity, item.product_name, item.hsn]
      );
    }

    /* =========================
       4️⃣ MARK BILL AS CANCELLED
    ========================== */
    await conn.query(
      "UPDATE bills SET status = 'CANCELLED' WHERE id = ?",
      [id]
    );

    await conn.commit();

    // req.flash("success", "Bill cancelled and stock restored");
    res.redirect("/billing");

  } catch (err) {
    await conn.rollback();
    console.error(err);
    // req.flash("error", err.message);
    res.redirect("/bills");
  } finally {
    conn.release();
  }
}));

app.post("/bills/:bid/payments/:id/delete", WrapAsync(async (req, res) => {
  const { id } = req.params;
  const{bid}=req.params;

  const conn = await connection.getConnection();

  try {
    await conn.beginTransaction();

    const [[payment]] = await conn.query(
      `SELECT p.bill_id, b.status
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
       WHERE p.id = ?`,
      [id]
    );

    if (!payment) throw new Error("Payment not found");

    if (payment.status === 'CANCELLED') {
      throw new Error("Cannot delete payment of a cancelled bill");
    }

    await conn.query(
      "DELETE FROM payments WHERE id = ?",
      [id]
    );

    await conn.commit();

    res.redirect(`/bills/${bid}/payments`);

  } catch (err) {
    await conn.rollback();
    // req.flash("error", err.message);
    res.redirect("back");
  } finally {
    conn.release();
  }
}));







app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message =
    err.sqlMessage ||
    err.message ||
    "Something occurred";

  res.status(status).send(message);
});








