async function getOrCreateCustomer(conn, name, phone, address, gstin) {
  const [rows] = await conn.query(
    `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
    [phone]
  );

  if (rows.length) return rows[0].id;

  const [result] = await conn.query(
    `INSERT INTO customers (name, phone, address)
     VALUES (?, ?, ?)`,
    [name, phone, address]
  );

  return result.insertId;
}
module.exports=getOrCreateCustomer;