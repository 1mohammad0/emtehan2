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
import { saveUser, saveSearch } from "./database.js";

// ================= SAVE USER MIDDLEWARE =================
bot.on("message", async (msg) => {
  try {
    // هر پیام → ذخیره کاربر در دیتابیس
    await saveUser(msg);
  } catch (e) {
    console.error("saveUser error:", e.message);
  }
});

// ================= MAIN MESSAGE HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

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

  // ================= SAVE SEARCH =================
  try {
    await saveSearch(msg.from.id, text);
  } catch (e) {
    console.error("saveSearch error:", e.message);
  }

  // ادامه منطق سرچ در پیام بعدی...
});
import { saveAI } from "./database.js";

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

// ================= AI MODE (UPDATED WITH DB) =================
async function askAI(product, question) {
  try {
    const res = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
تو یک فروشنده حرفه‌ای تاسیسات هستی.
فقط درباره محصولات جواب بده.
اگر سوال بی‌ربط بود فقط بنویس: بی‌مورد
`
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

// ================= SEARCH + AI HANDLER (FINAL LOGIC) =================
async function handleAI(chatId, product, question, msg) {
  const answer = await askAI(product, question);

  if (!answer || answer === "ERROR") {
    return bot.sendMessage(chatId, "❌ خطا در هوش مصنوعی");
  }

  // ذخیره در دیتابیس
  try {
    await saveAI(
      msg.from.id,
      product?.name || "",
      question,
      answer
    );
  } catch (e) {
    console.error("saveAI error:", e.message);
  }

  if (answer.includes("بی‌مورد")) {
    return bot.sendMessage(chatId, "❌ پیام شما بی‌مورد است");
  }

  return bot.sendMessage(chatId, answer);
}
import { saveSearch } from "./database.js";

// ================= PRODUCT SENDER =================
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
        [{ text: "🔙 بازگشت به لیست", callback_data: "back_list" }],
        [{ text: "🌐 جستجو در اینترنت", callback_data: `web_${product.name}` }],
        [{ text: "🤖 پرسش از هوش مصنوعی", callback_data: `ai_${product.name}` }]
      ]
    }
  });
}

// ================= CALLBACK =================
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;

  // ---------- BACK ----------
  if (q.data === "back_list") {
    const list = userCache.get(chatId);
    if (!list) return mainMenu(chatId);

    return bot.sendMessage(chatId, "🔙 لیست محصولات:", {
      reply_markup: {
        inline_keyboard: list.map(p => ([{
          text: p.name,
          callback_data: `open_${p.name}`
        }]))
      }
    });
  }

  // ---------- OPEN PRODUCT ----------
  if (q.data.startsWith("open_")) {
    const name = q.data.replace("open_", "");
    const products = await getProducts();

    const product = products.find(p => p.name === name);
    if (product) return sendProduct(chatId, product);
  }

  // ---------- WEB SEARCH ----------
  if (q.data.startsWith("web_")) {
    const query = q.data.replace("web_", "");
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    return bot.sendMessage(chatId,
`🌐 جستجو در اینترنت:

${url}`);
  }

  // ---------- AI MODE ----------
  if (q.data.startsWith("ai_")) {
    const productName = q.data.replace("ai_", "");

    userState.set(chatId, {
      mode: "ai",
      product: productName
    });

    return bot.sendMessage(chatId,
`🤖 سوال خود را درباره این محصول بنویس:

🛒 ${productName}`);
  }
});
