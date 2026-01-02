const express=require('express');
require("dotenv").config();

const app=express();
const port=8080;
const mysql = require("mysql2");
const path = require("path");
const methodOverride = require("method-override");
const fs = require("fs");
const ExpressError=require('./utils/error.js');

app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const ejsMate=require('ejs-mate')
app.engine('ejs',ejsMate)

const connection = mysql.createConnection({
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
app.get("/inventory", (req , res,next)=>{
 let q="select * from inventory";
 connection.query(q,(err,items)=>{
  if(err){
    return next(err);
  }
  
  res.render('inventory.ejs',{items});
 })
});
app.get("/add-inventory",(req,res)=>{
  res.render("add-inventory.ejs");
})

app.post("/add-inventory",(req,res,next)=>{
  let{name,category,brand,purchase_price,selling_price,stock,notes}=req.body;
  console.log(req.body);
  let q="INSERT INTO inventory (name, category, brand, purchase_price, selling_price, stock, notes) VALUES (?,?,?,?,?,?,?)";
  connection.query(q,[name,category,brand,purchase_price,selling_price,stock,notes],(err,result)=>{
    if(err){
      return next(new ExpressError(sqlMessage,500));
    }
    
    res.redirect("/inventory")
  })
})

app.use((err,req,res,next)=>{
  const status=err.status||500;
  const message=err.message||err.sqlMessage||"something went wrong";
  res.status(status).send(message);
})



