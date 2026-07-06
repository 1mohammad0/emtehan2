import TelegramBot from "node-telegram-bot-api";
import express from "express";
import axios from "axios";
import Fuse from "fuse.js";
import dotenv from "dotenv";

import { pool, initDB, saveUser, saveSearch, saveAI } from "./database.js";

dotenv.config();

// ================= BOT =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// ================= INIT DB =================
initDB();

// ================= ADMIN IDS =================
const ADMIN_IDS = (process.env.ADMIN_ID || "").split(",");

function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

// ================= CACHE =================
let cachedProducts = [];
let lastFetch = 0;

// ================= STATE =================
const userCache = new Map();
const userState = new Map();

// ================= MAIN MENU =================
function mainMenu(chatId) {
  bot.sendMessage(chatId, "🏠 منوی اصلی", {
    reply_markup: {
      keyboard: [
        ["🔍 جستجوی محصول"],
        ["📞 ارتباط با ما", "📢 کانال اصلی"],
        ["📍 آدرس فروشگاه"]
      ],
      resize_keyboard: true
    }
  });
}

// ================= GET PRODUCTS =================
async function getProducts() {
  try {
    const now = Date.now();

    if (cachedProducts.length && now - lastFetch < 30000) {
      return cachedProducts;
    }

    const url = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json`;
    const res = await axios.get(url, { timeout: 8000 });

    const text = res.data;
    const json = JSON.parse(
      text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1)
    );

    cachedProducts = json.table.rows.map(r => ({
      name: r.c?.[0]?.v || "",
      price: r.c?.[1]?.v || "",
      specs: r.c?.[2]?.v || "",
      status: r.c?.[3]?.v || "نامشخص"
    }));

    lastFetch = now;
    return cachedProducts;

  } catch (e) {
    console.error("Sheet error:", e.message);
    return cachedProducts;
  }
}

// ================= SMART SEARCH =================
function smartScore(text, product) {
  const t = text.toLowerCase().trim();
  const name = (product.name || "").toLowerCase();
  const specs = (product.specs || "").toLowerCase();

  let score = 0;

  if (name.includes(t)) score += 60;
  if (t.includes(name)) score += 40;

  for (const w of t.split(" ")) {
    if (w.length < 2) continue;
    if (name.includes(w)) score += 20;
    if (specs.includes(w)) score += 5;
  }

  return score;
}

// ================= AI =================
async function askAI(product, question) {
  try {
    const res = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "تو فروشنده حرفه‌ای تاسیسات هستی فقط درباره محصولات جواب بده."
          },
          {
            role: "user",
            content: `محصول: ${product?.name}\n${product?.price}\n${product?.specs}\n\nسوال: ${question}`
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.data.choices?.[0]?.message?.content || "ERROR";
  } catch (e) {
    return "ERROR";
  }
}

// ================= START =================
bot.onText(/\/start/, msg => mainMenu(msg.chat.id));

// ================= ADMIN PANEL =================
bot.onText(/\/admin/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;

  bot.sendMessage(msg.chat.id, "🛠 پنل ادمین", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "👤 کاربران", callback_data: "adm_users" }],
        [{ text: "🔎 سرچ‌ها", callback_data: "adm_search" }],
        [{ text: "🤖 AI لاگ", callback_data: "adm_ai" }],
        [{ text: "📊 آمار", callback_data: "adm_stats" }],
        [{ text: "📢 پیام همگانی", callback_data: "adm_broadcast" }]
      ]
    }
  });
});

// ================= MESSAGE =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  await saveUser(msg);

  if (text === "🔍 جستجوی محصول")
    return bot.sendMessage(chatId, "نام محصول را بنویس:");

  if (text === "📞 ارتباط با ما")
    return bot.sendMessage(chatId, "@m1348sh");

  if (text === "📢 کانال اصلی")
    return bot.sendMessage(chatId, "https://t.me/tasisatyeshagi");

  if (text === "📍 آدرس فروشگاه")
    return bot.sendLocation(chatId, 38.2598767, 48.3091167);

  await saveSearch(msg.from.id, text);

  const products = await getProducts();

  const fuse = new Fuse(products, { keys: ["name"], threshold: 0.3 });

  let results = fuse.search(text).map(r => r.item);

  if (!results.length)
    return bot.sendMessage(chatId, "❌ چیزی پیدا نشد");

  userCache.set(chatId, results);

  return bot.sendMessage(chatId, "🔍 نتایج:", {
    reply_markup: {
      inline_keyboard: results.map(p => ([{
        text: p.name,
        callback_data: `open_${p.name}`
      }]))
    }
  });
});

// ================= PRODUCT =================
function sendProduct(chatId, p) {
  bot.sendMessage(chatId,
`🛒 ${p.name}

💰 ${p.price}
📦 ${p.status}

📝 ${p.specs}`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "🔙 لیست", callback_data: "back" }],
      [{ text: "🌐 اینترنت", callback_data: `web_${p.name}` }],
      [{ text: "🤖 AI", callback_data: `ai_${p.name}` }]
    ]
  }
});
}

// ================= CALLBACK =================
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;

  // ========== ADMIN ==========
  if (isAdmin(q.from.id)) {

    if (q.data === "adm_users") {
      const r = await pool.query("SELECT * FROM users ORDER BY id DESC LIMIT 100");
      return bot.sendMessage(chatId,
        r.rows.map(u => `👤 ${u.first_name} (${u.telegram_id})`).join("\n")
      );
    }

    if (q.data === "adm_search") {
      const r = await pool.query("SELECT * FROM search_history ORDER BY id DESC LIMIT 50");
      return bot.sendMessage(chatId,
        r.rows.map(s => `🔎 ${s.search_text}`).join("\n")
      );
    }

    if (q.data === "adm_ai") {
      const r = await pool.query("SELECT * FROM ai_history ORDER BY id DESC LIMIT 50");
      return bot.sendMessage(chatId,
        r.rows.map(a => `🤖 ${a.question} -> ${a.answer}`).join("\n")
      );
    }

    if (q.data === "adm_stats") {
      const u = await pool.query("SELECT COUNT(*) FROM users");
      const s = await pool.query("SELECT COUNT(*) FROM search_history");
      const a = await pool.query("SELECT COUNT(*) FROM ai_history");

      return bot.sendMessage(chatId,
`📊 آمار

👤 کاربران: ${u.rows[0].count}
🔎 سرچ: ${s.rows[0].count}
🤖 AI: ${a.rows[0].count}`);
    }

    if (q.data === "adm_broadcast") {
      userState.set(chatId, { mode: "broadcast" });
      return bot.sendMessage(chatId, "پیام همگانی را بنویس:");
    }
  }

  // ========== USER ==========
  if (q.data.startsWith("open_")) {
    const name = q.data.replace("open_", "");
    const products = await getProducts();
    const p = products.find(x => x.name === name);
    if (p) sendProduct(chatId, p);
  }

  if (q.data.startsWith("web_")) {
    const q2 = q.data.replace("web_", "");
    return bot.sendMessage(chatId,
      `https://www.google.com/search?q=${encodeURIComponent(q2)}`
    );
  }

  if (q.data.startsWith("ai_")) {
    userState.set(chatId, { mode: "ai", product: q.data.replace("ai_", "") });
    return bot.sendMessage(chatId, "سوالت رو بنویس:");
  }
});
