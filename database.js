import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// ================= CONNECTION =================
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ================= INIT DATABASE =================
export async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS search_history (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        search_text TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_history (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        product_name TEXT,
        question TEXT,
        answer TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("✅ Database initialized");
  } catch (err) {
    console.error("❌ DB Init Error:", err.message);
  }
}

// ================= USERS =================
export async function saveUser(msg) {
  try {
    const { id, username, first_name, last_name } = msg.from;

    await pool.query(
      `
      INSERT INTO users (telegram_id, username, first_name, last_name, last_seen)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (telegram_id)
      DO UPDATE SET last_seen = NOW();
      `,
      [id, username || "", first_name || "", last_name || ""]
    );
  } catch (err) {
    console.error("saveUser error:", err.message);
  }
}

// ================= SEARCH HISTORY =================
export async function saveSearch(telegramId, text) {
  try {
    await pool.query(
      `
      INSERT INTO search_history (telegram_id, search_text)
      VALUES ($1, $2)
      `,
      [telegramId, text]
    );
  } catch (err) {
    console.error("saveSearch error:", err.message);
  }
}

// ================= AI HISTORY =================
export async function saveAI(telegramId, product, question, answer) {
  try {
    await pool.query(
      `
      INSERT INTO ai_history (telegram_id, product_name, question, answer)
      VALUES ($1, $2, $3, $4)
      `,
      [telegramId, product, question, answer]
    );
  } catch (err) {
    console.error("saveAI error:", err.message);
  }
}
