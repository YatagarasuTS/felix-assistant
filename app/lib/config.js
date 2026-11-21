// Настройки Феликса: %APPDATA%\Felix\config.json
const fs = require('fs');
const path = require('path');

// Темы облачка и окон настроек (сам Felix — в бирюзовом худи, поэтому «Мята» по умолчанию)
const THEMES = {
  mint:     { name: 'Мята',        accent: '#1FB5A3', accent2: '#5EF0D8', bg: '#071113', panel: 'rgba(8,24,27,0.82)',  text: '#E8FBF8', dim: '#86AFAA', dark: true },
  midnight: { name: 'Полночь',     accent: '#6C5CFF', accent2: '#3DD6FF', bg: '#06070D', panel: 'rgba(12,14,26,0.82)', text: '#E9ECFB', dim: '#8C93B5', dark: true },
  sunset:   { name: 'Закат',       accent: '#FF8A3D', accent2: '#FFC46B', bg: '#120A06', panel: 'rgba(30,16,8,0.82)',  text: '#FFF3E8', dim: '#C2A28A', dark: true },
  sakura:   { name: 'Сакура',      accent: '#FF5C93', accent2: '#FFC2D6', bg: '#14080D', panel: 'rgba(36,14,24,0.80)', text: '#FFF0F5', dim: '#C99AAE', dark: true },
  ember:    { name: 'Угли',        accent: '#E5383B', accent2: '#FF7B6B', bg: '#0D0505', panel: 'rgba(26,8,8,0.82)',   text: '#FBEDED', dim: '#B08888', dark: true },
  snow:     { name: 'Снег',        accent: '#139A8C', accent2: '#1FB5A3', bg: '#F1F6F6', panel: 'rgba(250,253,253,0.88)', text: '#0F1C1E', dim: '#5D7476', dark: false }
};

const DEFAULTS = {
  version: 1,
  firstRun: true,
  user: { nick: '' },
  theme: { preset: 'mint', accent: '#1FB5A3', radius: 14 },
  assistant: {
    enabled: true, scale: 1.0, side: 'right', lift: 8,
    voice: 'piper', pitch: 1.0, volume: 0.9, voiceSpeaker: 0,
    voiceHttp: { url: '', body: '', headers: '' },   // свой ИИ-голос: адрес ({text} — фраза), тело POST, заголовки «Имя: значение»
    mic: true, micDevice: 0, wake: true, winY: true, idle: true, idleMinutes: 10, minimized: false, subtitles: true
  },
  // ИИ для вопросов, которых Феликс сам не знает
  //   auto        — аккаунт Claude пользователя, если он подключён (ключ есть); иначе локальная модель, если запущена
  //   claude-api  — аккаунт Claude самого пользователя: его ключ API из console.anthropic.com
  //   local       — локальная модель через Ollama
  //   off         — не спрашивать нейросеть
  ai: { provider: 'auto', claudeKey: '', localUrl: 'http://127.0.0.1:11434', localModel: 'qwen2.5:7b', memory: true },
  weather: { city: '', lat: null, lon: null },
  music: 'youtube',   // куда отправлять «включи трек …»: youtube | yandex
  chats: [],          // ярлыки для Telegram/Discord: { say: 'мама', app: 'telegram'|'discord', target: 't.me/… | discord.com/channels/… | имя' }
  // «Феликс Link» на телефоне: код сопряжения, объявлять ли звонки голосом, показывать ли уведомления телефона.
  // Выключено, пока пользователь сам не включит в настройках: сервер связи слушает домашнюю сеть,
  // и Windows спросит про брандмауэр — пусть это случится, когда человек понимает зачем.
  // services — какие приложения телефона открывать для дел: { food|taxi|maps|shop|music: { pkg, label } } (выбирает пользователь);
  // places — адреса для «такси домой» и «маршрут до работы».
  phone: { enabled: false, code: '', announce: true, notifs: true, services: {}, places: { home: '', work: '' } },
  // гардероб: наряд, надетые вещи по слотам (каталог — app/ui/wardrobe-catalog.json), праздничные вещи сами по датам
  wardrobe: { outfit: 'mint', wear: { ears: 'headphones', head: '', face: '', neck: '', back: '', hand: '' }, holidays: true, holidayDone: '' },
  // напоминания: попить воды (каждый час) и размяться (каждые 50 минут)
  remind: { water: false, stretch: false },
  sounds: { ui: true },
  autostart: true
};

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = deepMerge(base[k], over[k]);
  return out;
}

class Config {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    fs.mkdirSync(dir, { recursive: true });
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { this.loadError = e.message; }   // BOM — если файл правили в Блокноте
    this.data = deepMerge(DEFAULTS, saved);
    this._t = null;
    // Claude Code (вход по подписке claude.ai) из публичной версии убран — правила Anthropic для сторонних программ
    if (this.data.ai.provider === 'claude-code') this.data.ai.provider = 'auto';
  }
  get() { return this.data; }
  patch(p) { this.data = deepMerge(this.data, p); this.save(); return this.data; }
  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this._t);
    try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2)); fs.renameSync(this.file + '.tmp', this.file); } catch (e) { console.error('config save', e); }
  }
  theme() {
    const t = THEMES[this.data.theme.preset] || THEMES.mint;
    return { ...t, accent: this.data.theme.accent || t.accent, radius: this.data.theme.radius };
  }
}

module.exports = { Config, THEMES, DEFAULTS };
