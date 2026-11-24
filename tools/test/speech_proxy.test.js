// The proxy against a fake SpeechMa. Nothing here uses the network or a real key.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSpeechProxy } = require('../lib/speech_proxy');

const KEY = 'sm_test_only';
const VOICES = [
  { voice_id: 'voice-7', name: 'Ava', language: 'English', locale: 'en-US', gender: 'Female', hd: false, styles: [] },
  { voice_id: 'voice-9', name: 'Multi', language: 'French', locale: 'fr-FR', gender: 'Male', hd: true, styles: [] },
  { voice_id: 'bad id!', name: 'Odd', language: 'English', locale: 'en-GB' },
];

async function setup(options = {}) {
  const calls = [], replies = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    if (url.includes('/voices')) return options.voicesReply?.() ?? Response.json({ success: true, voices: VOICES });
    const reply = replies.shift();
    if (reply) return reply();
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  };
  let time = 1_000_000;
  const handle = createSpeechProxy({ key: KEY, fetch, wait: async () => {}, now: () => time, ...options });
  const server = http.createServer(async (req, res) => {
    if (!await handle(req, res)) res.writeHead(404).end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => globalThis.fetch(`${base}/api/speech`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const tts = () => calls.filter(c => c.url.endsWith('/tts'));
  return { base, post, calls, tts, replies, advance: ms => { time += ms; }, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}
const check = (name, options, run) => test(name, async () => {
  const s = await setup(options);
  try { await run(s); } finally { await s.close(); }
});

check('speaks: sends the documented request and returns the audio', {}, async s => {
  const res = await s.post({ text: '  Hello   there ', voice: 'voice-7', rate: 20.4 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  const [call] = s.tts();
  assert.equal(call.url, 'https://speechma.com/api/v1/tts');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['X-API-Key'], KEY);
  assert.equal(call.redirect, 'error');
  assert.deepEqual(JSON.parse(call.body), { text: 'Hello there', voice: 'voice-7', rate: 20 });
});

check('lists only usable English voices, once', {}, async s => {
  const body = await (await fetch(`${s.base}/api/speech/voices`)).json();
  assert.deepEqual(body, { available: true, voices: [{ id: 'voice-7', name: 'Ava', locale: 'en-US', gender: 'Female', hd: false }] });
  await fetch(`${s.base}/api/speech/voices`);
  assert.equal(s.calls.length, 1);
});

for (const key of ['', '   ', 'sm_your_api_key']) {
  check(`without a real key (${JSON.stringify(key)}) nothing is called`, { key }, async s => {
    assert.deepEqual(await (await fetch(`${s.base}/api/speech/voices`)).json(), { available: false, voices: [] });
    assert.equal((await s.post({ text: 'hi', voice: 'voice-7' })).status, 503);
    assert.equal(s.calls.length, 0);
  });
}

check('rejects bad input without spending', {}, async s => {
  const bad = ['not json', {}, { text: 5, voice: 'voice-7' }, { text: 'hi', voice: 'voice-404' }, { text: 'hi', voice: 'voice-9' }, { text: ' ', voice: 'voice-7' }, { text: '[break 5s]', voice: 'voice-7' }];
  for (const body of bad) assert.equal((await s.post(body)).status, 400, JSON.stringify(body));
  assert.equal((await s.post({ text: 'x'.repeat(501), voice: 'voice-7' })).status, 413);
  assert.equal((await s.post('x'.repeat(5000))).status, 413);
  assert.equal((await s.post({ text: 'hi', voice: 'voice-7' }, { 'content-type': 'text/plain' })).status, 400);
  assert.equal((await fetch(`${s.base}/api/speech`)).status, 400);
  assert.equal(s.tts().length, 0);
});

check('other websites cannot use it', {}, async s => {
  for (const site of ['cross-site', 'same-site', 'none']) assert.equal((await s.post({ text: 'hi', voice: 'voice-7' }, { 'sec-fetch-site': site })).status, 400);
  assert.equal((await s.post({ text: 'hi', voice: 'voice-7' }, { 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal(s.tts().length, 1);
});

check('pause commands are removed and rate is clamped', {}, async s => {
  await s.post({ text: 'one [break 10s] two [ BREAK 500ms ]', voice: 'voice-7', rate: 900 });
  assert.deepEqual(JSON.parse(s.tts()[0].body), { text: 'one two', voice: 'voice-7', rate: 100 });
});

check('repeats come from memory, until they expire', {}, async s => {
  for (let i = 0; i < 3; i++) assert.equal((await s.post({ text: 'again', voice: 'voice-7' })).status, 200);
  assert.equal(s.tts().length, 1);
  s.advance(11 * 60_000);
  await s.post({ text: 'again', voice: 'voice-7' });
  assert.equal(s.tts().length, 2);
});

check('daily characters are capped', { limits: { charsPerDay: 10 } }, async s => {
  assert.equal((await s.post({ text: '12345678', voice: 'voice-7' })).status, 200);
  assert.equal((await s.post({ text: 'abc', voice: 'voice-7' })).status, 429);
  s.advance(25 * 3_600_000);
  assert.equal((await s.post({ text: 'abc', voice: 'voice-7' })).status, 200);
});

check('one visitor cannot use the whole hour', { limits: { requestsPerVisitorPerHour: 2 } }, async s => {
  const from = ip => ({ 'x-forwarded-for': ip });
  for (const t of ['a1', 'a2']) assert.equal((await s.post({ text: t, voice: 'voice-7' }, from('1.1.1.1'))).status, 200);
  assert.equal((await s.post({ text: 'a3', voice: 'voice-7' }, from('1.1.1.1'))).status, 429);
  assert.equal((await s.post({ text: 'a3', voice: 'voice-7' }, from('2.2.2.2'))).status, 200);
});

check('hourly total is capped', { limits: { requestsPerHour: 2 } }, async s => {
  for (const [t, status] of [['a', 200], ['b', 200], ['c', 429]]) assert.equal((await s.post({ text: t, voice: 'voice-7' })).status, status);
});

const error = status => () => Response.json({ success: false, error: `secret detail ${KEY}`, code: status }, { status });
for (const [upstream, expected] of [[400, 400], [401, 503], [402, 503], [403, 503], [429, 429], [404, 502]]) {
  check(`upstream ${upstream} becomes ${expected} without leaking details`, {}, async s => {
    s.replies.push(error(upstream));
    const res = await s.post({ text: 'hi', voice: 'voice-7' }), body = await res.text();
    assert.equal(res.status, expected);
    assert.ok(!body.includes('secret') && !body.includes(KEY));
    assert.equal(s.tts().length, 1);
  });
}

check('a server error is retried once', {}, async s => {
  s.replies.push(error(500));
  assert.equal((await s.post({ text: 'hi', voice: 'voice-7' })).status, 200);
  s.replies.push(error(500), error(500));
  assert.equal((await s.post({ text: 'ho', voice: 'voice-7' })).status, 502);
  assert.equal(s.tts().length, 4);
});

check('non-audio, empty and failed answers are errors and are not remembered', {}, async s => {
  s.replies.push(() => Response.json({ success: true }), () => new Response(null, { headers: { 'content-type': 'audio/mpeg' } }), () => { throw new TypeError('network'); });
  for (let i = 0; i < 3; i++) assert.equal((await s.post({ text: 'hi', voice: 'voice-7' })).status, 502);
  assert.equal((await s.post({ text: 'hi', voice: 'voice-7' })).status, 200);
});

check('a failed voice list is an error, then recovers', { voicesReply: (() => { let n = 0; return () => (n++ ? null : error(401)()); })() }, async s => {
  assert.equal((await fetch(`${s.base}/api/speech/voices`)).status, 503);
  assert.equal((await fetch(`${s.base}/api/speech/voices`)).status, 200);
});

check('malformed addresses do not crash the server', {}, async s => {
  const { hostname, port } = new URL(s.base);
  for (const path of ['//', '/%', '///a:b@c', '/api/speech/voices?%', '/%00']) {
    await new Promise((resolve, reject) => http.get({ hostname, port, path }, res => { res.resume(); res.on('end', resolve); }).on('error', reject));
  }
  assert.equal((await fetch(`${s.base}/api/speech/voices`)).status, 200);
});

check('other paths are left alone', {}, async s => {
  assert.equal((await fetch(`${s.base}/api/other`)).status, 404);
});
