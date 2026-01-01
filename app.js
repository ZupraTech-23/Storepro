const express=require('express');
require("dotenv").config();

const app=express();
const port=8080;
const mysql = require("mysql2");
const path = require("path");
const methodOverride = require("method-override");
const fs = require("fs");

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



