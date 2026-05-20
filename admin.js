const { Markup } = require('telegraf');
const db = require('./database');
const langs = require('./languages');

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);

const isAdmin = (id) => ADMIN_IDS.includes(id);

// ─── Admin bosh panel ───────────────────────────────────────────────
async function adminPanel(ctx) {
  const stats = db.getStats();
  await ctx.reply(
    `🛠 *Admin Panel*\n\n` +
    `👥 Jami foydalanuvchilar: *${stats.total}*\n` +
    `📅 Bugun qo'shildi: *${stats.today}*\n` +
    `🟢 Faol (24s): *${stats.active}*\n` +
    `🔗 Ulangan akkauntlar: *${stats.sessions}*\n` +
    `🗑 Jami chiqildi: *${stats.totalLeaves}*\n` +
    `🚫 Banlangan: *${stats.banned}*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📨 Broadcast', 'admin_broadcast'), Markup.button.callback('📊 Statistika', 'admin_stats')],
        [Markup.button.callback('👥 Foydalanuvchilar', 'admin_users'), Markup.button.callback('🚫 Ban/Unban', 'admin_ban_menu')],
        [Markup.button.callback('📢 Obuna kanallari', 'admin_check_channel'), Markup.button.callback('🔄 Yangilash', 'admin_refresh')],
      ]),
    }
  );
}

// ─── Statistika ─────────────────────────────────────────────────────
async function showStats(ctx) {
  await ctx.answerCbQuery();
  const stats = db.getStats();
  await ctx.editMessageText(
    `📊 *Batafsil Statistika*\n\n` +
    `👥 Jami foydalanuvchilar: *${stats.total}*\n` +
    `📅 Bugun qo'shildi: *${stats.today}*\n` +
    `🟢 Faol (24s): *${stats.active}*\n` +
    `🔗 Ulangan akkauntlar: *${stats.sessions}*\n` +
    `🗑 Jami chiqildi: *${stats.totalLeaves}*\n` +
    `🚫 Banlangan: *${stats.banned}*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Ortga', 'admin_back')],
      ]),
    }
  );
}

// ─── Foydalanuvchilar ro'yxati ───────────────────────────────────────
async function showUsers(ctx, page = 0) {
  await ctx.answerCbQuery().catch(() => {});
  const limit = 10;
  // FIX #1: getAllUsersAdmin va getUserCount database.js ga qo'shildi
  const users = db.getAllUsersAdmin(limit, page * limit);
  const total = db.getUserCount();

  if (users.length === 0) {
    return ctx.editMessageText('👥 Foydalanuvchilar topilmadi.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Ortga', 'admin_back')]]),
    });
  }

  let text = `👥 *Foydalanuvchilar* (${page * limit + 1}–${Math.min(page * limit + limit, total)} / ${total}):\n\n`;

  for (const u of users) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Nomsiz';
    const username = u.username ? `@${u.username}` : `ID: ${u.id}`;
    const status = u.is_banned ? '🚫' : u.blocked ? '❌' : '✅';
    text += `${status} ${name} — ${username}\n`;
  }

  const navButtons = [];
  if (page > 0) navButtons.push(Markup.button.callback('⬅️ Oldingi', `admin_users_page_${page - 1}`));
  if (page * limit + limit < total) navButtons.push(Markup.button.callback('Keyingi ➡️', `admin_users_page_${page + 1}`));

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      navButtons,
      [Markup.button.callback('🔙 Ortga', 'admin_back')],
    ]),
  });
}

// ─── Ban/Unban menyu ─────────────────────────────────────────────────
async function banMenu(ctx) {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🚫 *Ban/Unban*\n\nFoydalanuvchi ID sini yuboring:\n\`/ban <user_id>\` — Ban qilish\n\`/unban <user_id>\` — Bandan chiqarish`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Ortga', 'admin_back')]]),
    }
  );
}

// ─── Broadcast ───────────────────────────────────────────────────────
async function broadcastMenu(ctx) {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `📨 *Broadcast — Xabar yuborish*\n\n` +
    `Xabar matnini yuboring. Barcha faol foydalanuvchilarga yuboriladi.\n\n` +
    `*Ko'p tilli format (ixtiyoriy):*\n` +
    `\`\`\`\nuz\nO'zbek matni...\n---\nru\nРусский текст...\n---\nen\nEnglish text...\n\`\`\`\n\n` +
    `Yoki shunchaki matn yozing — hammaga bir xil yuboriladi.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_back')]]),
    }
  );
  ctx.session = ctx.session || {};
  ctx.session.adminStep = 'waiting_broadcast';
}

// ─── Broadcast yuborish ──────────────────────────────────────────────
async function handleBroadcast(ctx, text) {
  const messages = {};
  const parts = text.split('---').map(s => s.trim()).filter(Boolean);

  if (parts.length === 1) {
    for (const l of Object.keys(langs)) messages[l] = parts[0];
  } else {
    for (const part of parts) {
      const lines = part.split('\n');
      const langCode = lines[0].trim().toLowerCase();
      const msg = lines.slice(1).join('\n').trim();
      if (langs[langCode] && msg) messages[langCode] = msg;
    }
    if (Object.keys(messages).length === 0) {
      for (const l of Object.keys(langs)) messages[l] = text;
    }
  }

  const users = db.getAllUsers();
  let sent = 0, failed = 0;

  const progressMsg = await ctx.reply(`📤 *Yuborilmoqda...* (${users.length} ta foydalanuvchi)`, { parse_mode: 'Markdown' });

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const userLang = user.lang || 'uz';
    const msgText = messages[userLang] || messages['uz'] || messages['en'] || Object.values(messages)[0];
    if (!msgText) continue;

    try {
      await ctx.telegram.sendMessage(user.id, msgText, { parse_mode: 'Markdown' });
      sent++;
    } catch (e) {
      if (e.message && (e.message.includes('blocked') || e.message.includes('deactivated') || e.message.includes('not found'))) {
        db.blockUser(user.id);
      }
      failed++;
    }

    if ((i + 1) % 10 === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        `📤 *Yuborilmoqda...* ${i + 1}/${users.length}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 50));
  }

  await ctx.telegram.editMessageText(
    ctx.chat.id,
    progressMsg.message_id,
    null,
    `✅ *Broadcast tugadi!*\n\n✔️ Yuborildi: *${sent}*\n❌ Xato: *${failed}*`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  ctx.session.adminStep = null;
}

// ─── FIX #2: Majburiy obuna kanallari boshqaruvi ─────────────────────
async function showChannelManager(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const channels = db.getRequiredChannels();

  let text = `📢 *Majburiy Obuna Boshqaruvi*\n\n`;

  if (channels.length === 0) {
    text += `_Hozircha majburiy kanallar yo'q._\n\n`;
  } else {
    channels.forEach((ch, i) => {
      const icon = ch.type === 'group' ? '👥' : '📢';
      text += `${i + 1}. ${icon} ${ch.title || ch.channel_id} — \`${ch.channel_id}\`\n`;
    });
    text += '\n';
  }

  text += `➕ Kanal/guruh qo'shish uchun:\n\`/addchannel @username\`\n\nO'chirish uchun pastdagi tugmalardan foydalaning.`;

  const removeButtons = channels.map(ch => [
    Markup.button.callback(
      `🗑 ${ch.title || ch.channel_id}`,
      `admin_remove_channel_${ch.id}`
    )
  ]);

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      ...removeButtons,
      [Markup.button.callback('🔙 Ortga', 'admin_back')],
    ]),
  });
}

module.exports = {
  isAdmin,
  adminPanel,
  showStats,
  showUsers,
  banMenu,
  broadcastMenu,
  handleBroadcast,
  showChannelManager,
};
