// ============================================================
// SeatSure Backend - Database Connection (PostgreSQL / Supabase)
//
// Thin wrapper over `pg` that mimics the mysql2/promise API the
// rest of the code was written against, so index.js barely changes:
//   - `?` placeholders are rewritten to $1, $2, ...
//   - SELECT  -> resolves to [rows]
//   - INSERT/UPDATE/DELETE -> resolves to [{ affectedRows, insertId }]
//   - pool.getConnection() -> { query, beginTransaction, commit, rollback, release }
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Pool, types } = require("pg");

// COUNT(*) etc. come back as bigint -> string by default. Make them numbers.
types.setTypeParser(20, (v) => parseInt(v, 10));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL. Set DATABASE_SSL=false only for a local Postgres.
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: 10,
});

const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

async function run(client, sql, params = []) {
  let text = toPg(sql);
  const isInsert = /^\s*insert\s/i.test(text);
  if (isInsert && !/\breturning\b/i.test(text)) text += " RETURNING *";
  const r = await client.query(text, params);
  if (r.command === "SELECT") return [r.rows];
  const first = r.rows && r.rows[0];
  return [{ affectedRows: r.rowCount, insertId: first ? Object.values(first)[0] : 0 }];
}

module.exports = {
  query: (sql, params) => run(pool, sql, params),
  execute: (sql, params) => run(pool, sql, params),
  end: () => pool.end(),
  async getConnection() {
    const client = await pool.connect();
    let released = false;
    return {
      query: (sql, params) => run(client, sql, params),
      execute: (sql, params) => run(client, sql, params),
      beginTransaction: () => client.query("BEGIN"),
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      release: () => {
        if (!released) {
          released = true;
          client.release();
        }
      },
    };
  },
};
