const express=require('express');
const app=express();
const port=8080;
const mysql = require("mysql2");
const path = require("path");
const methodOverride = require("method-override");
app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
require("dotenv").config();

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
connection.query("SELECT 1", (err, result) => {
  if (err) {
    console.error("Connection failed ❌", err);
  } else {
    console.log("TiDB Connected Successfully ✅");
  }
  process.exit();
});