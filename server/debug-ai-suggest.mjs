import "dotenv/config";
import { pool } from "./db.js";

async function main() {
  const username = process.argv[2] || "Gopota";
  const word = process.argv[3] || "hello";

  const s = await pool.query(
    "SELECT token FROM sessions WHERE username = $1 ORDER BY login_time DESC LIMIT 1",
    [username]
  );
  if (!s.rows[0]?.token) {
    console.log(`No session token for "${username}". Please login as this user first.`);
    await pool.end();
    process.exit(0);
  }

  const token = s.rows[0].token;
  const res = await fetch("http://localhost:3000/api/admin/dictionary/ai-suggest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ lang: "en", word, existing: null }),
  });
  const text = await res.text();
  console.log("status", res.status);
  console.log(text);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

