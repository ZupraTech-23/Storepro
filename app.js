const express=require('express');
require("dotenv").config();

const app=express();
const port=8080;
const mysql = require("mysql2/promise");
const path = require("path");
const methodOverride = require('method-override')
const fs = require("fs");
const WrapAsync=require('./utils/wrapasync.js')
const ExpressError=require('./utils/error.js');
app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const ejsMate=require('ejs-mate');
const { error } = require('console');
app.engine('ejs',ejsMate)

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


app.listen(port ,(req,res)=>{
 console.log("working")
});

app.get("/dashboard", (req,res)=>{
  res.render("dashboard")
});

app.get("/",(req,res)=>{
  res.send("working")
})
app.get("/billing",(req,res)=>{
  res.render("billing")
});
app.get(
  "/inventory",
  WrapAsync(async (req, res) => {
    const q = "SELECT * FROM inventory";
    const [items] = await connection.query(q);
    
    

    res.render("inventory.ejs", { items });
  })
);

app.get("/add-inventory",(req,res)=>{
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



app.post("/add-inventory", WrapAsync(async (req, res,) => {

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
  if (category && category.toLowerCase() === "accessories")  {
    item_condition = "New";
  } else {
    if (!item_condition) {
      throw new ExpressError("Item condition is required", 400);
    }
  }

  const q = `
    INSERT INTO inventory
    (name, category, brand, purchase_price, selling_price, stock, item_condition)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
try{
  await connection.query(q, [
    name,
    category,
    brand,
    purchase_price,
    selling_price,
    stock,
    item_condition
  ])}
  catch(err){
    if(err.code==="ER_DUP_ENTRY"){
      throw new ExpressError("Item already exist ",400)
    }
    
  };

  res.redirect("/inventory");
}));



app.get('/edit-inventory/:id',WrapAsync(async(req,res,next)=>{
  let{id}=req.params;
  let q="select *from inventory where id =?";
  let [result]=await connection.query(q,[id]);
  let item=result[0];
  if(!item){
    throw new ExpressError("Inventory item not found",404);
  }

    
    
    
  res.render("edit-inventory.ejs",{item});
  
  
}));

app.patch('/edit-inventory/:id',WrapAsync(async(req,res)=>{
  let {id}=req.params;
  let{name,category,brand,purchase_price,selling_price,stock,item_condition}=req.body;
  let q="UPDATE inventory set name=?,category=?,brand=?,purchase_price=?,selling_price=?,stock=?,item_condition=? where id=?";
  await connection.query(q,[name,category,brand,purchase_price,selling_price,stock,item_condition,id]);

    res.redirect('/inventory');  
  
  

  
}))

app.delete('/delete-inventory/:id',WrapAsync(async(req,res)=>{
  let {id}=req.params;
  let q="delete from inventory where id =?";
  const [result]=await connection.query(q,[id])
  if(result.affectedRows===0){
    throw new ExpressError("Inventory item not found",404);
  }
    res.redirect("/inventory");
  
}))


//suggestion route for inventory


// bills
app.get("/bills/new",WrapAsync(async(req,res,next)=>{
   const [items] = await connection.query(
        "SELECT id, name, stock, selling_price FROM inventory WHERE stock > 0"
    );

    res.render("bills/new", {
        items
    });
  
}))

app.post("/bills/create", WrapAsync(async (req, res) => {

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        // 1️⃣ Get data from form
        const {
            bill_type,
            item_type,
            customer_name,
            customer_address,
            customer_phone,
            customer_gstin,
            subtotal,
            cgst,
            sgst,
            grand_total,
            items
        } = req.body;

        // 2️⃣ Generate invoice number
        const [[lastBill]] = await conn.query(
            "SELECT id FROM bills ORDER BY id DESC LIMIT 1"
        );

        const nextId = lastBill ? lastBill.id + 1 : 1;
        const invoiceNo = `INV-${new Date().getFullYear()}-${String(nextId).padStart(4, "0")}`;

        // 3️⃣ Insert into bills table
        const [billResult] = await conn.query(
            `INSERT INTO bills
            (invoice_no, bill_type, item_type,
             customer_name, customer_address,
             customer_phone, customer_gstin,
             subtotal, cgst, sgst, grand_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                invoiceNo,
                bill_type,
                item_type,
                customer_name,
                customer_address,
                customer_phone,
                customer_gstin,
                subtotal,
                cgst,
                sgst,
                grand_total
            ]
        );

        const billId = billResult.insertId;

        // 4️⃣ Insert bill items + update stock
        for (let item of items) {

            // 🔹 Fetch product name from inventory (column is `name`)
            const [[product]] = await conn.query(
                "SELECT name, stock FROM inventory WHERE id = ?",
                [item.product_id]
            );

            if (!product) {
                throw new Error("Invalid product selected");
            }

            // 🔹 Stock safety check
            if (bill_type !== "MEMORANDUM" && product.stock < item.quantity) {
                throw new Error(`Insufficient stock for ${product.name}`);
            }

            // 🔹 Insert bill item
            await conn.query(
                `INSERT INTO bill_items
                (bill_id, product_name, quantity, price, gst_percent, total)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    billId,
                    product.name,          // ✅ CORRECT
                    item.quantity,
                    item.price,
                    item.gst_percent,
                    item.total
                ]
            );

            // 🔹 Reduce stock (skip for memorandum)
            if (bill_type !== "MEMORANDUM") {
                await conn.query(
                    "UPDATE inventory SET stock = stock - ? WHERE id = ?",
                    [item.quantity, item.product_id]
                );
            }
        }

        // 5️⃣ Commit transaction
        await conn.commit();

        // 6️⃣ Redirect to bill view
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

    // 3️⃣ Get seller details (ONLY ONE ROW)
    const [[seller]] = await connection.query(
        "SELECT * FROM seller LIMIT 1"
    );

    res.render("bills/show", {
        bill,
        items,
        seller
    });
}));





app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message =
    err.sqlMessage ||
    err.message ||
    "Something occurred";

  res.status(status).send(message);
});








