import TelegramBot from "node-telegram-bot-api";
import express from "express";
import axios from "axios";
import Fuse from "fuse.js";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

// ================= BOT =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// ================= GEMINI =================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ================= CACHE (حل 502) =================
let cachedProducts = [];
let lastFetch = 0;

// ================= ADMIN =================
function isAdmin(userId) {
  const admins = (process.env.ADMIN_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  return admins.includes(String(userId));
}

// ================= MENU =================
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

// ================= GET PRODUCTS (CACHE FIX) =================
async function getProducts() {
  try {
    const now = Date.now();

    // استفاده از کش (خیلی مهم برای جلوگیری از 502)
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
    return cachedProducts; // fallback
  }
}

// ================= FILTER (AI SCOPE CONTROL) =================
function isRelatedToShop(text) {
  const keywords = [
    "پکیج", "شیر", "لوله", "رادیاتور",
    "پمپ", "تاسیسات", "شوفاژ",
    "قیمت", "خرید", "مدل"
  ];

  const t = text.toLowerCase();
  return keywords.some(k => t.includes(k));
}

// ================= GEMINI =================
async function askGemini(text, products) {
  const context = products
    .slice(0, 20)
    .map(p => `${p.name} | ${p.price} | ${p.specs}`)
    .join("\n");

  const prompt = `
تو یک فروشنده حرفه‌ای تاسیسات هستی.

اگر سوال ربط ندارد فقط بنویس:
"بی‌مورد"

محصولات:
${context}

سوال:
${text}
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ================= START =================
bot.onText(/\/start/, msg => mainMenu(msg.chat.id));

// ================= MESSAGE =================
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  // -------- MENU --------
  if (text === "🔍 جستجوی محصول") {
    return bot.sendMessage(chatId, "✍️ نام محصول یا دسته را بنویس:");
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

  // ================= SAFE LOAD =================
  const products = await getProducts();

  if (!products.length) {
    return bot.sendMessage(chatId, "❌ مشکل در دریافت محصولات");
  }

  // ================= AI MODE (ONLY SHOP) =================
  if (isRelatedToShop(text)) {
    try {
      const ai = await askGemini(text, products);

      if (ai.toLowerCase().includes("بی‌مورد")) {
        return bot.sendMessage(chatId, "❌ پیام شما بی‌مورد است");
      }

      return bot.sendMessage(chatId, ai);
    } catch (e) {
      console.error("Gemini error:", e.message);
    }
  }

  // ================= SEARCH MODE =================
  const fuse = new Fuse(products, {
    keys: ["name", "specs"],
    threshold: 0.5
  });

  const results = fuse.search(text).map(r => r.item);

  if (!results.length) {
    return bot.sendMessage(chatId, "❌ چیزی پیدا نشد");
  }

  if (results.length === 1) {
    return sendProduct(chatId, results[0]);
  }

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
        [{ text: "🔙 بازگشت", callback_data: "back" }],
        [{ text: "🌐 جستجو در گوگل", callback_data: `web_${product.name}` }]
      ]
    }
  });
}

// ================= CALLBACK =================
bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;

  if (q.data === "back") {
    return mainMenu(chatId);
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

    return bot.sendMessage(chatId, `🌐 جستجو:\n\n${url}`);
  }
});
