# 🧹 Tozalovch Bot v3.0

Telegram akkauntingizni keraksiz kanal, guruh va botlardan tozalovchi bot.

---

## 🚀 Render.com ga deploy qilish

### 1. Tayyorgarlik

1. [GitHub](https://github.com) da yangi repo yarating
2. Ushbu papkadagi barcha fayllarni o'sha repoga yuklang

### 2. Kerakli kalitlarni oling

| Kalit | Qayerdan | Izoh |
|-------|----------|------|
| `BOT_TOKEN` | [@BotFather](https://t.me/BotFather) | `/newbot` buyrug'i |
| `API_ID` | [my.telegram.org](https://my.telegram.org) | App Management → API ID |
| `API_HASH` | [my.telegram.org](https://my.telegram.org) | App Management → API Hash |
| `ADMIN_IDS` | [@userinfobot](https://t.me/userinfobot) | Sizning Telegram ID ingiz |

### 3. Render.com sozlash

1. [render.com](https://render.com) ga kiring
2. **New → Web Service** bosing
3. GitHub reponi ulang
4. Sozlamalar:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. **Environment Variables** bo'limiga quyidagilarni qo'shing:

```
BOT_TOKEN       = your_bot_token
API_ID          = your_api_id
API_HASH        = your_api_hash
ADMIN_IDS       = your_telegram_id
REQUIRED_CHANNEL = @your_channel   (ixtiyoriy)
```

6. **Deploy** tugmasini bosing ✅

---

## ⚙️ .env fayli (lokal ishlatish uchun)

`.env.example` faylini `.env` ga nusxalang:

```bash
cp .env.example .env
```

Keyin ichidagi qiymatlarni to'ldiring.

---

## 📁 Fayl tuzilmasi

```
tozalovch-bot/
├── index.js        # Asosiy bot fayli
├── userbot.js      # GramJS session boshqaruvi
├── database.js     # SQLite ma'lumotlar bazasi
├── admin.js        # Admin panel
├── languages.js    # Ko'p tillik qo'llab-quvvatlash
├── package.json    # Dependencylar
├── .env.example    # Namuna .env fayli
└── README.md       # Ushbu fayl
```

---

## 🛠 Funksiyalar

### Foydalanuvchi uchun:
- 🌐 Ko'p tillik: O'zbek, Rus, Ingliz
- 🔗 Akkaunt ulash (telefon + SMS)
- 🔐 2FA qo'llab-quvvatlash
- 📢 Kanallar, Guruhlar, Botlar skanerlash
- 🗑 Bittasidan yoki hammasidan chiqish
- 🔌 Akkauntni uzish
- 💾 Session saqlanadi (qayta ishga tushsa ham tikladi)

### Admin uchun (`/admin`):
- 📊 Batafsil statistika
- 📨 Broadcast (ko'p tillik)
- 👥 Foydalanuvchilar ro'yxati (sahifalash bilan)
- 🚫 Ban / Unban
- 🔄 Real-vaqt yangilash

---

## ⚠️ Muhim eslatmalar

- **Render free plan** — bot 15 daqiqa faolsizlikdan keyin uxlaydi. Bot ichidagi keep-alive cron buni oldini oladi.
- **SQLite** — Render free da fayl tizimi vaqtinchalik. Doimiy saqlash uchun PostgreSQL (Render) yoki Railway ishlating.
- **Session xavfsizligi** — Bot token va API kalitlarni hech kimga bermang!
