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

// ================= PRODUCTS =================
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

  if (name === t) score += 100;
  if (name.includes(t)) score += 60;
  if (t.includes(name)) score += 40;

  const words = t.split(" ");
  for (const w of words) {
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
            content: `تو یک فروشنده حرفه‌ای تاسیسات هستی. فقط درباره محصولات جواب بده. اگر سوال بی‌ربط بود فقط بنویس: بی‌مورد`
          },
          {
            role: "user",
            content: `
محصول:
${product?.name || ""}
${product?.price || ""}
${product?.specs || ""}

سوال:
${question}
`
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
  } catch (err) {
    console.error("AI ERROR:", err.response?.data || err.message);
    return "ERROR";
  }
}

// ================= START =================
bot.onText(/\/start/, msg => mainMenu(msg.chat.id));

// ================= MESSAGE (ONLY ONE HANDLER) =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  try {
    await saveUser(msg);
  } catch (e) {
    console.error("saveUser error:", e.message);
  }

  // ---------- MENU ----------
  if (text === "🔍 جستجوی محصول") {
    return bot.sendMessage(chatId, "✍️ نام یا دسته محصول را بنویس:");
  }

  if (text === "📞 ارتباط با ما") {
    return bot.sendMessage(chatId, "📞 @m1348sh\n📱 09143531348");
  }

  if (text === "📢 کانال اصلی") {
    return bot.sendMessage(chatId, "https://t.me/tasisatyeshagi");
  }

  if (text === "📍 آدرس فروشگاه") {
    return bot.sendLocation(chatId, 38.2598767, 48.3091167);
  }

  try {
    await saveSearch(msg.from.id, text);
  } catch (e) {
    console.error("saveSearch error:", e.message);
  }

  // ---------- SEARCH ----------
  const products = await getProducts();

  const fuse = new Fuse(products, {
    keys: ["name", "specs"],
    threshold: 0.3
  });

  let results = fuse.search(text).map(r => r.item);

  if (!results.length) {
    return bot.sendMessage(chatId, "❌ چیزی پیدا نشد");
  }

  if (results.length === 1) {
    return sendProduct(chatId, results[0]);
  }

  userCache.set(chatId, results);

  return bot.sendMessage(chatId,
`🔍 ${results.length} محصول پیدا شد:`,
{
  reply_markup: {
    inline_keyboard: results.map(p => ([{
      text: p.name,
      callback_data: `open_${p.name}`
    }]))
  }
});
});

// ================= PRODUCT =================
function sendProduct(chatId, product) {
  return bot.sendMessage(chatId,
`🛒 ${product.name}

💰 قیمت: ${product.price}
📦 وضعیت: ${product.status}

📝 مشخصات:
${product.specs || "-"}`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "🔙 بازگشت", callback_data: "back_list" }],
      [{ text: "🌐 اینترنت", callback_data: `web_${product.name}` }],
      [{ text: "🤖 AI", callback_data: `ai_${product.name}` }]
    ]
  }
});
}

// ================= CALLBACK =================
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;

  if (q.data === "back_list") {
    const list = userCache.get(chatId);
    if (!list) return mainMenu(chatId);

    return bot.sendMessage(chatId, "🔙 لیست:", {
      reply_markup: {
        inline_keyboard: list.map(p => ([{
          text: p.name,
          callback_data: `open_${p.name}`
        }]))
      }
    });
  }

  if (q.data.startsWith("open_")) {
    const name = q.data.replace("open_", "");
    const products = await getProducts();

    const product = products.find(p => p.name === name);
    if (product) return sendProduct(chatId, product);
  }

  if (q.data.startsWith("web_")) {
    const query = q.data.replace("web_", "");
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    return bot.sendMessage(chatId, `🌐\n${url}`);
  }

  if (q.data.startsWith("ai_")) {
    const productName = q.data.replace("ai_", "");

    userState.set(chatId, {
      mode: "ai",
      product: productName
    });

    return bot.sendMessage(chatId,
`🤖 سوالت رو درباره این محصول بپرس:

🛒 ${productName}`);
  }
});
