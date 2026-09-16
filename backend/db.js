// ============================================================
// SeatSure Backend - Database Connection
// ============================================================
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "", // set your MySQL password here if any
  database: "seatsure",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
