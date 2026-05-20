require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const UserSession = require('./userbot');
const db = require('./database');
const langs = require('./languages');
const admin = require('./admin');

// ─── Tekshiruv ───────────────────────────────────────────────────────
const REQUIRED = ['BOT_TOKEN', 'API_ID', 'API_HASH'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌ .env da ${key} yo'q!`);
    process.exit(1);
  }
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);

// ─── Bot ─────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ─── RAM'da session'lar (UserSession obyektlari) ──────────────────────
const userSessions = new Map(); // userId → UserSession

// ─── Til olish ───────────────────────────────────────────────────────
function L(userId) {
  const langCode = db.getLang(userId) || 'uz';
  return langs[langCode] || langs['uz'];
}

// ─── UserSession olish (yoki qayta ulash) ────────────────────────────
async function getOrRestoreSession(userId) {
  if (userSessions.has(userId)) {
    const s = userSessions.get(userId);
    if (s.isAuthorized()) return s;
  }

  // DB dan session tiklash
  const saved = db.getSession(userId);
  if (saved) {
    const s = new UserSession(userId);
    const ok = await s.reconnect();
    if (ok) {
      userSessions.set(userId, s);
      return s;
    } else {
      db.deleteSession(userId);
    }
  }
  return null;
}

// ─── Obuna tekshirish ─────────────────────────────────────────────────
async function checkSubscription(ctx) {
  if (!REQUIRED_CHANNEL) return true;
  try {
    const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch {
    return true; // Kanal topilmasa — ruxsat berish
  }
}

// ─── Asosiy menyu tugmalari ──────────────────────────────────────────
function mainMenuKeyboard(userId) {
  const l = L(userId);
  return Markup.inlineKeyboard([
    [Markup.button.callback('📢 ' + l.scan_channels, 'scan_channels'),
     Markup.button.callback('👥 ' + l.scan_groups, 'scan_groups')],
    [Markup.button.callback('🤖 ' + l.scan_bots, 'scan_bots'),
     Markup.button.callback('🔍 ' + l.scan_all, 'scan_all')],
    [Markup.button.callback('🔌 ' + l.disconnect, 'disconnect'),
     Markup.button.callback('❓ ' + l.help, 'help')],
    [Markup.button.callback('⚙️ ' + l.settings, 'settings')],
  ]);
}

// ─── Til tanlash klaviaturasi ─────────────────────────────────────────
function langKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇺🇿 O\'zbek', 'lang_uz'),
      Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      Markup.button.callback('🇬🇧 English', 'lang_en'),
    ],
  ]);
}

// ─── /start ──────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const { id, first_name, last_name, username } = ctx.from;

  // Ban tekshirish
  if (db.isBanned(id)) return ctx.reply(L(id).banned);

  // DB ga saqlash
  db.saveUser(id, username, first_name, last_name, db.getLang(id) || 'uz');

  // Obuna tekshirish
  if (REQUIRED_CHANNEL && !(await checkSubscription(ctx))) {
    return ctx.reply(
      L(id).subscribe_required(REQUIRED_CHANNEL),
      Markup.inlineKeyboard([
        [Markup.button.url('📢 Kanalga o\'tish', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
        [Markup.button.callback(L(id).check_sub, 'check_sub')],
      ])
    );
  }

  const name = first_name || 'Foydalanuvchi';
  await ctx.reply(L(id).welcome(name), { parse_mode: 'Markdown', ...langKeyboard() });
});

// ─── Til tanlash ──────────────────────────────────────────────────────
for (const code of ['uz', 'ru', 'en']) {
  bot.action(`lang_${code}`, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.from.id;
    db.setLang(id, code);

    const l = langs[code];

    // Obuna tekshirish
    if (REQUIRED_CHANNEL && !(await checkSubscription(ctx))) {
      const channelLink = `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`;
      const btnText = code === 'ru' ? 'Перейти в канал' : code === 'en' ? 'Go to channel' : "Kanalga o\'tish";
      await ctx.editMessageText(
        `✅ Til tanlandi: ${l.flag} *${l.name}*\n\n` + l.subscribe_required(REQUIRED_CHANNEL),
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url('📢 ' + btnText, channelLink)],
            [Markup.button.callback(l.check_sub, 'check_sub')],
          ]),
        }
      );
      return;
    }

    const session = await getOrRestoreSession(id);

    if (session) {
      const savedSession = db.getSession(id);
      await ctx.editMessageText(
        l.already_connected(savedSession?.phone || ''),
        { parse_mode: 'Markdown', ...mainMenuKeyboard(id) }
      );
    } else {
      await ctx.editMessageText(
        `✅ Til tanlandi: ${l.flag} *${l.name}*\n\nAkkauntingizni ulang:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔗 ' + l.connect_account, 'connect_account')],
            [Markup.button.callback('❓ ' + l.help, 'help')],
          ]),
        }
      );
    }
  });
}

// ─── Obuna tekshirish callback ────────────────────────────────────────
bot.action('check_sub', async (ctx) => {
  const id = ctx.from.id;
  const l = L(id);

  if (await checkSubscription(ctx)) {
    await ctx.answerCbQuery('✅');
    const session = await getOrRestoreSession(id);

    if (session) {
      const saved = db.getSession(id);
      await ctx.editMessageText(
        l.already_connected(saved?.phone || ''),
        { parse_mode: 'Markdown', ...mainMenuKeyboard(id) }
      );
    } else {
      await ctx.editMessageText(
        `✅ Obuna tasdiqlandi!\n\nAkkauntingizni ulang:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔗 ' + l.connect_account, 'connect_account')],
            [Markup.button.callback('❓ ' + l.help, 'help')],
          ]),
        }
      );
    }
  } else {
    await ctx.answerCbQuery(l.not_subscribed, { show_alert: true });
  }
});

// ─── Akkaunt ulash ───────────────────────────────────────────────────
bot.action('connect_account', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  if (db.isBanned(id)) return;

  ctx.session = ctx.session || {};
  ctx.session.step = 'waiting_phone';

  await ctx.reply(L(id).enter_phone, {
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ ' + L(id).cancel, 'cancel')]]),
  });
});

// ─── Bekor qilish ────────────────────────────────────────────────────
bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  ctx.session = ctx.session || {};
  ctx.session.step = null;
  ctx.session.adminStep = null;

  await ctx.reply(
    '❌ Bekor qilindi.',
    Markup.inlineKeyboard([
      [Markup.button.callback('🔗 ' + L(id).connect_account, 'connect_account')],
    ])
  );
});

// ─── Skanerlash ──────────────────────────────────────────────────────
async function handleScan(ctx, type) {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  const l = L(id);

  const userSession = await getOrRestoreSession(id);
  if (!userSession) {
    return ctx.reply(
      l.not_connected,
      Markup.inlineKeyboard([[Markup.button.callback('🔗 ' + l.connect_account, 'connect_account')]])
    );
  }

  const typeNames = {
    channels: l.scan_channels,
    groups: l.scan_groups,
    bots: l.scan_bots,
    all: l.scan_all,
  };

  const scanMsg = await ctx.reply(`${l.scanning}\n\n🔍 *${typeNames[type]}* skanerlanyapti...`, { parse_mode: 'Markdown' });

  let dialogs = [];
  try {
    dialogs = await userSession.getDialogs(type);
  } catch (err) {
    await ctx.telegram.deleteMessage(id, scanMsg.message_id).catch(() => {});
    return ctx.reply(l.error(err.message));
  }

  await ctx.telegram.deleteMessage(id, scanMsg.message_id).catch(() => {});

  if (dialogs.length === 0) {
    return ctx.reply(l.nothing(typeNames[type]), { parse_mode: 'Markdown', ...mainMenuKeyboard(id) });
  }

  // Session ga saqlash
  ctx.session = ctx.session || {};
  ctx.session.dialogs = dialogs;
  ctx.session.scanType = type;
  ctx.session.page = 0;
  ctx.session.keptIds = [];
  ctx.session.toLeave = [];

  await showDialogPage(ctx, 0);
}

// ─── Dialog sahifalarini ko'rsatish ──────────────────────────────────
async function showDialogPage(ctx, page) {
  const id = ctx.from.id;
  const l = L(id);
  const dialogs = ctx.session?.dialogs || [];
  const kept = ctx.session?.keptIds || []; // ✅ saqlanganlar
  const PAGE_SIZE = 8;
  const total = dialogs.length;
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  const slice = dialogs.slice(start, end);

  const typeNames = {
    channels: l.scan_channels,
    groups: l.scan_groups,
    bots: l.scan_bots,
    all: l.scan_all,
  };
  const typeName = typeNames[ctx.session?.scanType] || '';

  // 2 tadan 1 qatorda
  const buttons = [];
  for (let i = 0; i < slice.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, slice.length); j++) {
      const d = slice[j];
      const icon = d.type === 'kanal' ? '📢' : d.type === 'guruh' ? '👥' : '🤖';
      const isKept = kept.includes(d.id);
      const label = `${isKept ? '✅ ' : ''}${icon} ${d.title.substring(0, 18)}`;
      row.push(Markup.button.callback(label, `keep_${d.id}`));
    }
    buttons.push(row);
  }

  // Navigatsiya
  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️', `page_${page - 1}`));
  navRow.push(Markup.button.callback(`${page + 1}/${Math.ceil(total / PAGE_SIZE)}`, 'noop'));
  if (end < total) navRow.push(Markup.button.callback('➡️', `page_${page + 1}`));
  if (navRow.length) buttons.push(navRow);

  const leaveCount = dialogs.filter(d => !kept.includes(d.id)).length;
  const leaveLabel = leaveCount > 0 ? `🗑 Chiqish (${leaveCount} ta)` : `🗑 ` + l.leave_all;
  buttons.push([
    Markup.button.callback(leaveLabel, 'leave_all'),
    Markup.button.callback('🔙 ' + l.back, 'back_main'),
  ]);

  const keptCount = kept.length;
  const text = l.found(total, typeName) + (keptCount > 0 ? `\n\n✅ *${keptCount}* ta saqlanadi` : `\n\n_Saqlamoqchi bo'lganlarni belgilang_`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    }).catch(() =>
      ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
    );
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

// ─── Scan actionlar ──────────────────────────────────────────────────
bot.action('scan_channels', (ctx) => handleScan(ctx, 'channels'));
bot.action('scan_groups', (ctx) => handleScan(ctx, 'groups'));
bot.action('scan_bots', (ctx) => handleScan(ctx, 'bots'));
bot.action('scan_all', (ctx) => handleScan(ctx, 'all'));

// ─── Sahifa navigatsiya ───────────────────────────────────────────────
bot.action(/^page_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const page = parseInt(ctx.match[1]);
  ctx.session = ctx.session || {};
  ctx.session.page = page;
  await showDialogPage(ctx, page);
});

bot.action('noop', (ctx) => ctx.answerCbQuery());

// ─── Saqlash (✅ belgilash — bu kanalda qolaman)
bot.action(/^keep_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  const dialogId = ctx.match[1];
  ctx.session = ctx.session || {};
  const kept = ctx.session.keptIds || [];

  if (kept.includes(dialogId)) {
    // Belgini olib tashlash
    ctx.session.keptIds = kept.filter(k => k !== dialogId);
  } else {
    // Belgilash
    ctx.session.keptIds = [...kept, dialogId];
  }

  await showDialogPage(ctx, ctx.session.page || 0);
});
// ─── Hammasidan chiqish ───────────────────────────────────────────────
bot.action('leave_all', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  const l = L(id);
  const dialogs = ctx.session?.dialogs || [];
  const kept = ctx.session?.keptIds || [];

  const toLeave = dialogs.filter(d => !kept.includes(d.id));

  if (toLeave.length === 0) {
    await ctx.answerCbQuery("✅ Chiqiladigan yo'q, hammasi belgilangan!", { show_alert: true });
    return;
  }

  const userSession = await getOrRestoreSession(id);
  if (!userSession) return ctx.reply(l.not_connected);

  ctx.session.toLeave = toLeave;

  await ctx.editMessageText(
    `⚠️ *${toLeave.length}* ta dan chiqilsinmi?\n\n✅ *${kept.length}* ta saqlanib qoladi`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ha, chiqish', 'leave_all_confirm'),
         Markup.button.callback('❌ Bekor', 'back_main')],
      ]),
    }
  );
});

bot.action('leave_all_confirm', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  const l = L(id);
  const toLeave = ctx.session?.toLeave || ctx.session?.dialogs || [];

  const userSession = await getOrRestoreSession(id);
  if (!userSession) return ctx.reply(l.not_connected);

  const progressMsg = await ctx.reply(l.leaving_all(toLeave.length), { parse_mode: 'Markdown' });

  let ok = 0, fail = 0;

  for (let i = 0; i < toLeave.length; i++) {
    const d = toLeave[i];
    try {
      await userSession.leaveDialog(d.id, d.type);
      ok++;
    } catch {
      fail++;
    }

    if ((i + 1) % 5 === 0 || i === toLeave.length - 1) {
      await ctx.telegram.editMessageText(
        id, progressMsg.message_id, null,
        `⏳ Jarayon: *${i + 1}/${toLeave.length}*
✔️ Muvaffaqiyatli: ${ok}
❌ Xato: ${fail}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  ctx.session.dialogs = [];
  ctx.session.keptIds = [];
  ctx.session.toLeave = [];

  await ctx.telegram.editMessageText(
    id, progressMsg.message_id, null,
    l.done(ok, fail),
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  await ctx.reply('🏠 Bosh menyu:', { parse_mode: 'Markdown', ...mainMenuKeyboard(id) });
});

// ─── Ortga qaytish ────────────────────────────────────────────────────
bot.action('back_main', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  const userSession = await getOrRestoreSession(id);

  if (userSession) {
    const saved = db.getSession(id);
    await ctx.editMessageText(
      L(id).already_connected(saved?.phone || ''),
      { parse_mode: 'Markdown', ...mainMenuKeyboard(id) }
    ).catch(() =>
      ctx.reply(L(id).already_connected(saved?.phone || ''), { parse_mode: 'Markdown', ...mainMenuKeyboard(id) })
    );
  } else {
    await ctx.editMessageText(
      '🏠 Bosh menyu:',
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔗 ' + L(id).connect_account, 'connect_account')],
        ]),
      }
    ).catch(() => {});
  }
});

// ─── Yordam ───────────────────────────────────────────────────────────
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  await ctx.reply(L(id).help_text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔙 ' + L(id).back, 'back_main')],
    ]),
  });
});

// ─── Sozlamalar ───────────────────────────────────────────────────────
bot.action('settings', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  await ctx.reply(
    '⚙️ *Sozlamalar*\n\nTilni o\'zgartirish:',
    { parse_mode: 'Markdown', ...langKeyboard() }
  );
});

// ─── Akkaunt uzish ────────────────────────────────────────────────────
bot.action('disconnect', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  const l = L(id);
  await ctx.reply(
    l.disconnect_confirm,
    Markup.inlineKeyboard([
      [Markup.button.callback(l.disconnect_yes, 'disconnect_confirm'),
       Markup.button.callback(l.disconnect_no, 'back_main')],
    ])
  );
});

bot.action('disconnect_confirm', async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.from.id;
  const l = L(id);

  const userSession = userSessions.get(id);
  if (userSession) {
    await userSession.disconnect();
    userSessions.delete(id);
  } else {
    db.deleteSession(id);
  }

  await ctx.editMessageText(l.disconnected, {
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔗 ' + l.connect_account, 'connect_account')],
    ]),
  });
});

// ─── Admin panel ──────────────────────────────────────────────────────
bot.command('admin', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return;
  await admin.adminPanel(ctx);
});

bot.action('admin_back', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
  await admin.adminPanel(ctx);
});

bot.action('admin_refresh', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
  await ctx.answerCbQuery('✅ Yangilandi');
  await ctx.deleteMessage().catch(() => {});
  await admin.adminPanel(ctx);
});

bot.action('admin_stats', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
  await admin.showStats(ctx);
});

bot.action('admin_users', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
  await admin.showUsers(ctx, 0);
});

bot.action(/^admin_users_page_(\d+)$/, async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await admin.showUsers(ctx, parseInt(ctx.match[1]));
});

bot.action('admin_ban_menu', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
  await admin.banMenu(ctx);
});

bot.action('admin_broadcast', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
  await admin.broadcastMenu(ctx);
});

// ─── Admin buyruqlar ──────────────────────────────────────────────────
bot.command('ban', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return;
  const args = ctx.message.text.split(' ');
  const targetId = parseInt(args[1]);
  if (!targetId) return ctx.reply('❌ Format: /ban <user_id>');
  db.banUser(targetId);
  ctx.reply(`🚫 Foydalanuvchi ${targetId} banlandi.`);
});

bot.command('unban', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return;
  const args = ctx.message.text.split(' ');
  const targetId = parseInt(args[1]);
  if (!targetId) return ctx.reply('❌ Format: /unban <user_id>');
  db.unbanUser(targetId);
  ctx.reply(`✅ Foydalanuvchi ${targetId} bandan chiqarildi.`);
});

bot.command('stats', async (ctx) => {
  if (!admin.isAdmin(ctx.from.id)) return;
  const stats = db.getStats();
  ctx.reply(
    `📊 *Statistika*\n\n👥 Jami: *${stats.total}*\n📅 Bugun: *${stats.today}*\n🟢 Faol: *${stats.active}*\n🔗 Sessionlar: *${stats.sessions}*\n🗑 Chiqildi: *${stats.totalLeaves}*\n🚫 Ban: *${stats.banned}*`,
    { parse_mode: 'Markdown' }
  );
});

// ─── Matn xabarlari (step machine) ────────────────────────────────────
bot.on('text', async (ctx) => {
  const id = ctx.from.id;
  if (db.isBanned(id)) return ctx.reply(L(id).banned);

  db.updateActivity(id);
  ctx.session = ctx.session || {};

  // ─── Admin broadcast ─────────────────────────────────────────────
  if (admin.isAdmin(id) && ctx.session.adminStep === 'waiting_broadcast') {
    ctx.session.adminStep = null;
    await admin.handleBroadcast(ctx, ctx.message.text);
    return;
  }

  const step = ctx.session.step;
  const l = L(id);

  // ─── Telefon raqam ───────────────────────────────────────────────
  if (step === 'waiting_phone') {
    const phone = ctx.message.text.trim();
    if (!/^\+?[0-9]{7,15}$/.test(phone)) {
      return ctx.reply(l.wrong_input, {
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ ' + l.cancel, 'cancel')]]),
      });
    }

    const waitMsg = await ctx.reply(l.sending_code);

    let userSession = new UserSession(id);
    userSessions.set(id, userSession);

    try {
      await userSession.sendCode(phone);
      ctx.session.step = 'waiting_code';
      ctx.session.phone = phone;

      await ctx.telegram.deleteMessage(id, waitMsg.message_id).catch(() => {});
      await ctx.reply(l.enter_code, {
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ ' + l.cancel, 'cancel')]]),
      });
    } catch (err) {
      await ctx.telegram.deleteMessage(id, waitMsg.message_id).catch(() => {});
      ctx.session.step = null;
      userSessions.delete(id);

      let errMsg = err.message;
      if (errMsg.includes('PHONE_NUMBER_INVALID')) errMsg = "Telefon raqami noto'g'ri!";
      else if (errMsg.includes('TOO_MANY_REQUESTS') || errMsg.includes('FLOOD')) errMsg = 'Juda ko\'p urinish. Keyinroq urinib ko\'ring.';
      await ctx.reply(l.error(errMsg));
    }
    return;
  }

  // ─── SMS kod ─────────────────────────────────────────────────────
  if (step === 'waiting_code') {
    const code = ctx.message.text.trim();
    if (!/^\d{5,6}$/.test(code)) {
      return ctx.reply(l.wrong_input, {
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ ' + l.cancel, 'cancel')]]),
      });
    }

    const userSession = userSessions.get(id);
    if (!userSession) {
      ctx.session.step = null;
      return ctx.reply(l.not_connected, {
        ...Markup.inlineKeyboard([[Markup.button.callback('🔗 ' + l.connect_account, 'connect_account')]]),
      });
    }

    try {
      await userSession.signIn(ctx.session.phone, code);
      ctx.session.step = null;

      const me = await userSession.getMe();
      const name = me?.firstName || 'Foydalanuvchi';

      await ctx.reply(l.connected(name), { parse_mode: 'Markdown', ...mainMenuKeyboard(id) });
    } catch (err) {
      if (err.message && err.message.includes('SESSION_PASSWORD_NEEDED')) {
        ctx.session.step = 'waiting_2fa';
        return ctx.reply(l.enter_2fa, {
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ ' + l.cancel, 'cancel')]]),
        });
      }
      ctx.session.step = null;
      let errMsg = err.message;
      if (errMsg.includes('PHONE_CODE_INVALID')) errMsg = 'Kod noto\'g\'ri!';
      else if (errMsg.includes('PHONE_CODE_EXPIRED')) errMsg = 'Kod muddati o\'tdi. Qaytadan urinib ko\'ring.';
      await ctx.reply(l.error(errMsg));
    }
    return;
  }

  // ─── 2FA ─────────────────────────────────────────────────────────
  if (step === 'waiting_2fa') {
    const password = ctx.message.text.trim();
    const userSession = userSessions.get(id);

    if (!userSession) {
      ctx.session.step = null;
      return ctx.reply(l.not_connected);
    }

    try {
      await userSession.checkPassword(password);
      ctx.session.step = null;

      const me = await userSession.getMe();
      const name = me?.firstName || 'Foydalanuvchi';

      await ctx.reply(l.connected(name), { parse_mode: 'Markdown', ...mainMenuKeyboard(id) });
    } catch (err) {
      let errMsg = err.message;
      if (errMsg.includes('PASSWORD_HASH_INVALID')) errMsg = 'Parol noto\'g\'ri!';
      await ctx.reply(l.error(errMsg));
    }
    return;
  }

  // ─── Boshqa xabar ────────────────────────────────────────────────
  const userSession = await getOrRestoreSession(id);
  if (userSession) {
    const saved = db.getSession(id);
    await ctx.reply(l.already_connected(saved?.phone || ''), {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(id),
    });
  } else {
    await ctx.reply(
      `Boshlash uchun /start ni bosing yoki akkauntingizni ulang:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🔗 ' + l.connect_account, 'connect_account')],
      ])
    );
  }
});

// ─── Xato ushlash ────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[Bot] Xato (${ctx?.from?.id}):`, err.message);
  if (ctx?.reply) {
    ctx.reply('⚠️ Ichki xato yuz berdi. Iltimos qaytadan urinib ko\'ring.').catch(() => {});
  }
});

// ─── Express (Render uchun) ──────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  const stats = db.getStats();
  res.json({
    status: 'online',
    bot: 'Tozalovch Bot',
    users: stats.total,
    sessions: stats.sessions,
    uptime: Math.floor(process.uptime()) + 's',
  });
});

app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`🌐 Server ishga tushdi: http://localhost:${PORT}`);
});

// ─── Keep-alive (Render uchun — free plan uxlamaydi) ─────────────────
if (process.env.RENDER_EXTERNAL_URL) {
  const cron = require('node-cron');
  const https = require('https');
  cron.schedule('*/14 * * * *', () => {
    const url = process.env.RENDER_EXTERNAL_URL + '/health';
    https.get(url, (res) => {
      console.log(`[Keep-alive] ${res.statusCode}`);
    }).on('error', () => {});
  });
}

// ─── Botni ishga tushirish ────────────────────────────────────────────
console.log('🤖 Tozalovch Bot ishga tushmoqda...');

bot.launch({
  allowedUpdates: ['message', 'callback_query'],
}).then(() => {
  console.log('✅ Bot muvaffaqiyatli ishga tushdi!');
}).catch((err) => {
  console.error('❌ Bot ishga tushmadi:', err.message);
  process.exit(1);
});

// ─── Graceful shutdown ────────────────────────────────────────────────
process.once('SIGINT', () => {
  console.log('⛔ Bot to\'xtatilmoqda...');
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  console.log('⛔ Bot to\'xtatilmoqda...');
  bot.stop('SIGTERM');
  process.exit(0);
});
