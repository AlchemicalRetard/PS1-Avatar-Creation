// Server side of online voices. Keeps the SpeechMa key off the page and caps what visitors can spend.
// API: https://speechma.com/api/ (POST /v1/tts returns MP3 bytes, GET /v1/voices lists voices).
// Never logs the key or what people type.

const DEFAULT_LIMITS = {
  textLength: 500,
  charsPerDay: 20_000, // Starter includes 1,000,000 a month
  requestsPerHour: 80, // Starter allows 100
  requestsPerDay: 400, // Starter allows 500
  requestsPerVisitorPerHour: 30,
  concurrent: 2, // Starter allows 3
  bodyBytes: 4096,
  timeoutMs: 25_000,
  cacheEntries: 20,
  cacheMs: 10 * 60_000,
  voicesMs: 24 * 60 * 60_000,
};
const HOUR = 3_600_000, DAY = 24 * HOUR;

// What the page is told. Upstream messages are not passed on.
const MESSAGES = {
  bad_request: [400, 'That text or voice cannot be spoken.'],
  too_long: [413, 'That text is too long.'],
  not_set_up: [503, 'Online voices are not set up.'],
  account: [503, 'The online voice account needs attention.'],
  busy: [429, 'Online voices are busy or have reached their limit. Try again later, or use a device voice.'],
  failed: [502, 'The online voice did not answer. Try again, or use a device voice.'],
};

function createSpeechProxy({ key = '', baseUrl = 'https://speechma.com/api/v1', fetch = globalThis.fetch, limits: custom = {}, now = Date.now, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...custom };
  const ready = key.trim().length > 0 && !/your_api_key/.test(key);
  const cache = new Map();
  let history = []; // { time, chars, visitor }
  let active = 0;
  let voices = null, voicesTime = 0, voicesRequest = null;

  class Problem extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };

  async function call(path, options = {}) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetch(baseUrl + path, {
          ...options,
          redirect: 'error', // never forward the key elsewhere
          headers: { 'X-API-Key': key.trim(), ...options.headers },
          signal: AbortSignal.timeout(limits.timeoutMs),
        });
      } catch {
        throw new Problem('failed');
      }
      if (response.ok) return response;
      if (response.status === 500 && attempt === 0) {
        await wait(2000);
        continue;
      }
      if ([401, 402, 403].includes(response.status)) throw new Problem('account');
      if (response.status === 429) throw new Problem('busy');
      throw new Problem(response.status === 400 ? 'bad_request' : 'failed');
    }
  }

  async function listVoices() {
    if (voices && now() - voicesTime < limits.voicesMs) return voices;
    voicesRequest ??= (async () => {
      try {
        const body = await (await call('/voices?language=English')).json().catch(() => null);
        if (!Array.isArray(body?.voices)) throw new Problem('failed');
        voices = body.voices
          .filter(v => typeof v.voice_id === 'string' && /^[\w-]{1,64}$/.test(v.voice_id) && typeof v.name === 'string' && /^en\b/i.test(String(v.locale)))
          .map(v => ({ id: v.voice_id, name: v.name.slice(0, 60), locale: String(v.locale).slice(0, 12), gender: String(v.gender ?? '').slice(0, 12), hd: v.hd === true }));
        voicesTime = now();
        return voices;
      } finally {
        voicesRequest = null;
      }
    })();
    return voicesRequest;
  }

  function spend(visitor, chars) {
    const time = now();
    history = history.filter(h => time - h.time < DAY);
    const hour = history.filter(h => time - h.time < HOUR);
    const over = history.length >= limits.requestsPerDay
      || hour.length >= limits.requestsPerHour
      || hour.filter(h => h.visitor === visitor).length >= limits.requestsPerVisitorPerHour
      || history.reduce((sum, h) => sum + h.chars, 0) + chars > limits.charsPerDay;
    if (over) throw new Problem('busy');
    history.push({ time, chars, visitor });
  }

  async function readJson(req) {
    const parts = [];
    let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > limits.bodyBytes) throw new Problem('too_long');
      parts.push(part);
    }
    try {
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch {
      throw new Problem('bad_request');
    }
  }

  async function speak(req, visitor) {
    const body = await readJson(req);
    if (typeof body?.text !== 'string' || typeof body.voice !== 'string') throw new Problem('bad_request');
    // [break …] is SpeechMa's pause command, not something to say.
    const text = body.text.replace(/\[\s*break[^\]]*\]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!text) throw new Problem('bad_request');
    if (text.length > limits.textLength) throw new Problem('too_long');
    const rate = Number.isFinite(body.rate) ? Math.round(Math.max(-100, Math.min(100, body.rate))) : 0;
    if (!(await listVoices()).some(v => v.id === body.voice)) throw new Problem('bad_request');

    const id = JSON.stringify([body.voice, rate, text]);
    for (const [k, entry] of cache) if (now() - entry.time > limits.cacheMs) cache.delete(k);
    if (cache.has(id)) return cache.get(id).audio;
    if (active >= limits.concurrent) throw new Problem('busy');
    spend(visitor, text.length);
    active += 1;
    try {
      const response = await call('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: body.voice, ...(rate ? { rate } : {}) }),
      });
      if (!/^audio\//i.test(response.headers.get('content-type') ?? '')) throw new Problem('failed');
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length) throw new Problem('failed');
      cache.set(id, { audio, time: now() });
      if (cache.size > limits.cacheEntries) cache.delete(cache.keys().next().value);
      return audio;
    } finally {
      active -= 1;
    }
  }

  /** Handles /api/speech requests; returns false for anything else. */
  return async function handle(req, res) {
    const pathname = req.url.split('?')[0]; // not new URL(): malformed addresses must not throw
    if (pathname !== '/api/speech' && pathname !== '/api/speech/voices') return false;
    try {
      // Browsers set this themselves, so other websites cannot use the key through a visitor.
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin') throw new Problem('bad_request');
      if (pathname === '/api/speech/voices') {
        if (req.method !== 'GET') throw new Problem('bad_request');
        send(res, 200, ready ? { available: true, voices: await listVoices() } : { available: false, voices: [] });
        return true;
      }
      if (req.method !== 'POST' || !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new Problem('bad_request');
      if (!ready) throw new Problem('not_set_up');
      const visitor = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
      const audio = await speak(req, visitor);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(audio);
    } catch (error) {
      const [status, message] = MESSAGES[error.code] ?? MESSAGES.failed;
      if (!MESSAGES[error.code]) console.error('Speech proxy error:', error.name);
      if (!res.headersSent) send(res, status, { error: message });
      else res.end();
    }
    return true;
  };
}

module.exports = { createSpeechProxy, DEFAULT_LIMITS };
