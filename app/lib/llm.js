// Вопросы, которых Феликс сам не знает, — нейросети.
// Источники (config.ai.provider):
//   claude-api — аккаунт пользователя в Anthropic: его собственный ключ API (console.anthropic.com), хранится зашифрованным;
//   local      — Ollama на этом компьютере;  auto — ключ, если есть, иначе Ollama;  off — не спрашивать.
// Подписки claude.ai (Free/Pro/Max) сторонние программы по правилам Anthropic использовать не могут,
// поэтому входа «через claude.ai» и запуска чужого Claude Code здесь нет — только ключ API самого пользователя.
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;

const MODEL = 'claude-opus-5-5';

const SYSTEM = 'Ты — Феликс, голосовой ассистент на рабочем столе Windows: молодой парень, дружелюбный, с лёгким юмором. ' +
  'Твоё имя по-латыни значит «удачливый». Отвечай по-русски, на «ты», коротко: одно–три предложения. ' +
  'Ответ будет озвучен синтезатором речи, поэтому пиши без markdown, списков, ссылок, эмодзи и спецсимволов; ' +
  'числа и единицы пиши так, как их произносят. Если просят сделать что-то на компьютере, чего ты не умеешь, ' +
  'честно скажи и подскажи, где это сделать.';

class LlmError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

/** Ошибка SDK → код для понятной фразы */
function codeOf(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'auth';
  if (e instanceof Anthropic.PermissionDeniedError) return 'region';
  if (e instanceof Anthropic.RateLimitError) return 'busy';
  if (e instanceof Anthropic.BadRequestError) return 'bad';
  if (e instanceof Anthropic.APIConnectionError) return 'network';
  if (e instanceof Anthropic.APIError) return e.status >= 500 ? 'busy' : 'bad';
  return 'network';
}

class Llm {
  /** opts: { getConfig: () => config.ai, getKey: () => string|null, log } */
  constructor(opts) {
    this.opts = opts;
    this.history = [];          // последние вопросы и ответы — для «а сколько ему лет?» после «кто такой…»
    this.client = null; this.clientKey = null;
  }

  async ollamaUp() {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(this.localBase() + '/api/tags', { signal: ctl.signal }); clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }
  localBase() { return String(this.opts.getConfig().localUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/v1$/, ''); }

  /** Какой источник сработает сейчас: 'claude-api' | 'local' | null */
  async pick() {
    const c = this.opts.getConfig();
    if (c.provider === 'off') return null;
    if (c.provider === 'claude-api') return this.opts.getKey() ? 'claude-api' : null;
    if (c.provider === 'local') return 'local';
    if (this.opts.getKey()) return 'claude-api';
    if (await this.ollamaUp()) return 'local';
    return null;
  }

  clientFor(key) {
    if (!this.client || this.clientKey !== key) { this.client = new Anthropic({ apiKey: key, timeout: 60000, maxRetries: 1 }); this.clientKey = key; }
    return this.client;
  }

  /** Проверка ключа пользователя: есть ли у его аккаунта доступ к модели (токены не тратятся) */
  async checkKey(key) {
    try {
      const c = new Anthropic({ apiKey: key, timeout: 20000, maxRetries: 0 });
      await c.models.retrieve(MODEL);
      return { ok: true };
    } catch (e) {
      const code = codeOf(e);
      return { ok: false, code, error: code === 'auth' ? 'Ключ не подошёл: проверь, что скопирован целиком.' : code === 'network' ? 'Не удалось проверить: нет связи с Anthropic.' : code === 'region' ? 'Anthropic не пускает из этой сети.' : 'Ключ не прошёл проверку: ' + (e.message || code) };
    }
  }

  /** Вопрос с короткой памятью разговора: прошлые вопросы и ответы идут текстом перед новым вопросом */
  prompt(q) {
    const now = new Date().toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const mem = this.opts.getConfig().memory !== false && this.history.length
      ? 'Недавний разговор:\n' + this.history.map(h => `Пользователь: ${h.q}\nФеликс: ${h.a}`).join('\n') + '\n\n' : '';
    return `${mem}Сейчас: ${now}.\nВопрос: ${q}`;
  }

  remember(q, a) {
    this.history.push({ q, a });
    if (this.history.length > 4) this.history.shift();
  }

  async ask(q) {
    const src = await this.pick();
    if (!src) throw new LlmError('none');
    let text = src === 'claude-api' ? await this.askClaudeApi(q) : await this.askLocal(q);
    text = String(text || '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 700);
    if (!text) throw new LlmError('empty');
    this.remember(q, text);
    return { text, source: src };
  }

  // ---- аккаунт пользователя в Anthropic: его ключ, официальный SDK
  async askClaudeApi(q) {
    const key = this.opts.getKey();
    if (!key) throw new LlmError('nokey');
    let res;
    try {
      res = await this.clientFor(key).beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // если модель откажется отвечать по соображениям безопасности, API сам повторит запрос на запасной модели
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // короткие голосовые ответы: низкое усилие — быстрее и дешевле для пользователя
        output_config: { effort: 'low' },
        system: SYSTEM,
        messages: [{ role: 'user', content: this.prompt(q) }]
      });
    } catch (e) { throw new LlmError(codeOf(e), e.message); }
    if (res.stop_reason === 'refusal') throw new LlmError('refused');
    return res.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
  }

  // ---- локальная модель через Ollama (бесплатно и без интернета)
  async askLocal(q) {
    const c = this.opts.getConfig();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 120000);
    try {
      const r = await fetch(this.localBase() + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ model: c.localModel || 'qwen2.5:7b', stream: false, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: this.prompt(q) }] })
      });
      if (r.status === 404) throw new LlmError('nomodel');
      if (!r.ok) throw new LlmError('local', 'HTTP ' + r.status);
      const j = await r.json();
      return (j.message && j.message.content) || '';
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError('local', e.message);
    } finally { clearTimeout(t); }
  }
}

/** Что сказать вслух, если нейросеть не ответила */
function explain(e) {
  switch (e && e.code) {
    case 'none': return 'Этого я не знаю, а нейросеть не подключена. Подключи свой аккаунт Claude в настройках, раздел «Нейросеть».';
    case 'nokey': return 'Подключи свой аккаунт Claude: настройки, раздел «Нейросеть».';
    case 'auth': return 'Ключ Claude не подошёл. Проверь его в настройках, раздел «Нейросеть».';
    case 'region': return 'Нейросеть сейчас недоступна из этой сети. Попробуй позже или через другое подключение.';
    case 'busy': return 'Нейросеть сейчас перегружена. Спроси чуть позже, пожалуйста.';
    case 'refused': return 'На такой вопрос я ответить не могу.';
    case 'nomodel': return 'Локальная модель не найдена. Проверь её название в настройках.';
    case 'local': return 'Не получилось связаться с локальной моделью. Запущен ли Ollama?';
    case 'network': return 'Не получилось связаться с нейросетью: проблема с интернетом.';
    default: return 'Нейросеть не ответила. Попробуй ещё раз.';
  }
}

module.exports = { Llm, LlmError, explain, MODEL };
