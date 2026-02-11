import "dotenv/config";
import { pool } from "./db.js";

const username = process.argv[2] || "Gopota";
const res = await pool.query(
  "UPDATE users SET is_admin = true WHERE username = $1 RETURNING username, is_admin",
  [username]
);
console.log(res.rows.length ? `OK: ${username} is_admin=${res.rows[0].is_admin}` : `User "${username}" not found`);
await pool.end();
