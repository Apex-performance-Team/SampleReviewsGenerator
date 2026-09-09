import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'undici';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HASH = 'eeb803ca9122d1d9568f48ba0f36938c2907894d25f455d2a10edb7985b95e4f';
const EXPIRES = Date.parse('2026-09-12T12:00:00Z');
const ZONE = 'nate_archive_browser';
const H = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
  'referrer-policy': 'no-referrer',
};
const hash = (x) => createHash('sha256').update(String(x)).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(req) {
  const q = new URL(req.url).searchParams;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || q.get('ticket') || '';
  const url = q.get('url') || '';
  const authorized = token && Date.now() < EXPIRES && timingSafeEqual(Buffer.from(hash(token), 'hex'), Buffer.from(HASH, 'hex'));
  if (!authorized || !/^https:\/\/x\.com\/i\/article\/\d+$/.test(url)) return new Response('Not found', { status: 404 });

  const key = process.env.BRIGHT_DATA_API_KEY || '';
  let password = '';
  let ws;
  const safe = (e) => String(e?.message || e)
    .split(key).join('[REDACTED]')
    .split(password).join('[REDACTED]')
    .split(token).join('[REDACTED]')
    .slice(0, 1000);

  async function http(u, auth) {
    const r = await fetch(u, {
      headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(40000),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 500)}`);
    return t ? JSON.parse(t) : null;
  }

  try {
    const account = await http('https://api.brightdata.com/status', key);
    const creds = await http(`https://api.brightdata.com/zone/passwords?zone=${ZONE}`, key);
    password = creds.passwords?.[0] || '';
    if (!account.customer || !password) throw new Error('browser credentials unavailable');

    ws = new WebSocket('wss://brd.superproxy.io:9222', {
      headers: {
        Authorization: `Basic ${Buffer.from(`brd-customer-${account.customer}-zone-${ZONE}:${password}`).toString('base64')}`,
      },
    });

    const pending = new Map();
    let seq = 0;
    ws.addEventListener('message', async (event) => {
      let message;
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text()); } catch { return; }
      if (!message.id || !pending.has(message.id)) return;
      const p = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(p.timer);
      message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), 30000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('connect error')); }, { once: true });
    });

    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout:${method}`)); }, 90000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

    const target = await send('Target.createTarget', { url: 'about:blank' });
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const cmd = (method, params = {}) => send(method, params, attached.sessionId);
    await cmd('Page.enable');
    await cmd('Runtime.enable');
    await cmd('Page.navigate', { url });

    for (let i = 0; i < 45; i++) {
      const e = await cmd('Runtime.evaluate', {
        expression: '({ready:document.readyState,title:document.title,len:(document.body?.innerText||"").length,url:location.href})',
        returnByValue: true,
      });
      const v = e.result?.value || {};
      if (v.len > 300 && v.ready !== 'loading') { await sleep(2500); break; }
      await sleep(1000);
    }

    const expression = `(() => {
      const pick = (selector) => [...document.querySelectorAll(selector)].slice(0, 10).map((el) => ({
        tag: el.tagName,
        cls: String(el.className || ''),
        testid: el.getAttribute('data-testid'),
        text: (el.innerText || '').slice(0, 12000),
        html: (el.outerHTML || '').slice(0, 12000),
      }));
      const bodyText = document.body?.innerText || '';
      return {
        url: location.href,
        title: document.title,
        ready: document.readyState,
        bodyText: bodyText.slice(0, 30000),
        bodyLen: bodyText.length,
        articles: pick('article'),
        testids: pick('[data-testid*="article" i],[data-testid*="tweetText" i]'),
        headings: pick('h1,h2,h3'),
        scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 30),
        resources: performance.getEntriesByType('resource').map((r) => r.name).filter((x) => /article|graphql|tweet|longform/i.test(x)).slice(0, 80),
      };
    })()`;
    const extracted = await cmd('Runtime.evaluate', { expression, returnByValue: true });
    return Response.json(extracted.result?.value || null, { headers: H });
  } catch (e) {
    return Response.json({ error: safe(e) }, { status: 502, headers: H });
  } finally {
    try { ws?.close(); } catch {}
  }
}
