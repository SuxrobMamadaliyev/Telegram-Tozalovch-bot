const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const db = require('./database');

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;

class UserSession {
  constructor(userId) {
    this.userId = userId;
    this.phone = null;
    this.phoneCodeHash = null;
    this._authorized = false;
    this.client = null;
  }

  // Clientni yaratish yoki mavjudini qaytarish
  async _getClient(sessionString = '') {
    if (this.client && this.client.connected) return this.client;

    const session = new StringSession(sessionString);
    
    this.client = new TelegramClient(session, API_ID, API_HASH, {
      connectionRetries: 15,
      retryDelay: 2000,
      autoReconnect: true,
      useWSS: false,
      floodSleepThreshold: 60,
    });

    return this.client;
  }

  // Mavjud sessiondan qayta ulanish
  async reconnect() {
    const saved = db.getSession(this.userId);
    if (!saved) return false;

    try {
      const client = await this._getClient(saved.session_string);
      await client.connect();

      if (await client.isUserAuthorized()) {
        this._authorized = true;
        this.phone = saved.phone;
        return true;
      }
    } catch (err) {
      console.error(`[UserSession] Reconnect xato (${this.userId}):`, err.message);
      if (err.message.includes('AUTH_KEY_UNREGISTERED')) {
        db.deleteSession(this.userId);
      }
    }
    return false;
  }

  // SMS kod yuborish
  async sendCode(phone) {
    this.phone = phone;
    const client = await this._getClient();
    await client.connect();

    try {
      const result = await client.sendCode(
        { apiId: API_ID, apiHash: API_HASH },
        phone
      );
      this.phoneCodeHash = result.phoneCodeHash;
      return result;
    } catch (err) {
      console.error('[UserSession] sendCode xato:', err.message);
      throw err;
    }
  }

  // Kodni tekshirish va kirish
  async signIn(phone, code) {
    try {
      await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash: this.phoneCodeHash,
          phoneCode: code.trim(),
        })
      );

      this._authorized = true;
      await this._saveSession();
      return true;
    } catch (err) {
      throw err;
    }
  }

  // 2FA parolini tekshirish
  async checkPassword(password) {
    try {
      await this.client.signInWithPassword(
        { apiId: API_ID, apiHash: API_HASH },
        {
          password: async () => password.trim(),
          onError: (err) => { throw err; },
        }
      );

      this._authorized = true;
      await this._saveSession();
      return true;
    } catch (err) {
      throw err;
    }
  }

  // Sessionni DB ga saqlash
  async _saveSession() {
    try {
      const sessionString = this.client.session.save();
      db.saveSession(this.userId, sessionString, this.phone);
    } catch (err) {
      console.error('[UserSession] Session saqlash xato:', err.message);
    }
  }

  async getMe() {
    try {
      return await this.client.getMe();
    } catch {
      return null;
    }
  }

  isAuthorized() {
    return this._authorized;
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }
    } catch (err) {
      console.error('[UserSession] Disconnect xato:', err.message);
    }
    this._authorized = false;
    db.deleteSession(this.userId);
  }

  // Dialoglarni olish (Kanal, Guruh, Bot)
  async getDialogs(type) {
    if (!this.client || !this.client.connected) {
        const ok = await this.reconnect();
        if (!ok) return [];
    }
    
    const allDialogs = await this.client.getDialogs({ limit: 500 });
    const results = [];

    for (const dialog of allDialogs) {
      const entity = dialog.entity;
      if (!entity) continue;

      const isChannel = entity.className === 'Channel' && !entity.megagroup;
      const isMegagroup = entity.className === 'Channel' && entity.megagroup;
      const isGroup = entity.className === 'Chat' || isMegagroup;
      const isBot = entity.className === 'User' && entity.bot;

      let matches = false;
      let entityType = '';

      if (type === 'channels' && isChannel) { matches = true; entityType = 'kanal'; }
      else if (type === 'groups' && isGroup) { matches = true; entityType = 'guruh'; }
      else if (type === 'bots' && isBot) { matches = true; entityType = 'bot'; }
      else if (type === 'all' && (isChannel || isGroup || isBot)) {
        matches = true;
        entityType = isChannel ? 'kanal' : isGroup ? 'guruh' : 'bot';
      }

      if (matches) {
        results.push({
          id: entity.id.toString(),
          title: dialog.title || entity.username || entity.firstName || 'Nomsiz',
          type: entityType,
          username: entity.username || '',
        });
      }
    }
    return results;
  }

  // Dialogdan chiqish
  async leaveDialog(id, type) {
    try {
      let entity;
      try {
        entity = await this.client.getEntity(id);
      } catch (e) {
        // getEntity ishlamasa dialogs dan qidiramiz
        const dialogs = await this.client.getDialogs({ limit: 500 });
        const found = dialogs.find(d => d.entity && d.entity.id && d.entity.id.toString() === id.toString());
        if (!found) throw new Error(`Dialog topilmadi: ${id}`);
        entity = found.entity;
      }

      if (entity.className === 'User') {
        // Bot bo'lsa — tarixni o'chirib bloklash
        try {
          await this.client.invoke(new Api.messages.DeleteHistory({
            peer: entity,
            maxId: 0,
            revoke: true
          }));
        } catch (e) { /* tarix o'chirilmasa ham davom et */ }
        try {
          await this.client.invoke(new Api.contacts.Block({ id: entity }));
        } catch (e) { /* bloklash xatosi e'tiborga olinmaydi */ }
      } else if (entity.className === 'Chat') {
        // Oddiy guruh
        await this.client.invoke(new Api.messages.DeleteChatUser({
          chatId: entity.id,
          userId: 'me',
        }));
      } else if (entity.className === 'Channel') {
        // Kanal yoki Supergroup
        await this.client.invoke(new Api.channels.LeaveChannel({
          channel: entity,
        }));
      }

      db.addStat(this.userId, 'leave');
      return true;
    } catch (err) {
      console.error(`[LeaveDialog] Xato ID: ${id} ->`, err.message);
      throw err;
    }
  }
}

module.exports = UserSession;
