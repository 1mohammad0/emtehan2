-- ==============================
-- Telegram Shop Bot Database
-- PostgreSQL Schema
-- ==============================

-- ================= USERS =================
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW()
);

-- ================= SEARCH HISTORY =================
CREATE TABLE IF NOT EXISTS search_history (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  search_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ================= AI HISTORY =================
CREATE TABLE IF NOT EXISTS ai_history (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  product_name TEXT,
  question TEXT,
  answer TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ================= INDEXES (برای سرعت بهتر) =================

CREATE INDEX IF NOT EXISTS idx_users_telegram_id
ON users(telegram_id);

CREATE INDEX IF NOT EXISTS idx_search_telegram_id
ON search_history(telegram_id);

CREATE INDEX IF NOT EXISTS idx_ai_telegram_id
ON ai_history(telegram_id);

-- ================= DONE =================
-- این فایل را می‌توانی مستقیم در Render PostgreSQL اجرا کنی
-- یا در pgAdmin / DBeaver import کنی
