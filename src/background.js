const api = globalThis.browser ?? globalThis.chrome;

// Frankfurter's v1 is deprecated in favour of v2, which returns a different
// shape. Try v2 first and fall back to v1, so a retirement of either one does
// not break currency conversion.
const FX_V2 = 'https://api.frankfurter.dev/v2/rates?base=USD';
const FX_V1 = 'https://api.frankfurter.dev/v1/latest?base=USD';
const FX_TTL = 12 * 60 * 60 * 1000;

let inflight = null;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fx ${res.status}`);
  return res.json();
}

function parse(body) {
  // v2: [{ date, base, quote, rate }, ...]
  if (Array.isArray(body)) {
    const rates = {};
    for (const q of body) {
      if (q && typeof q.quote === 'string' && Number.isFinite(q.rate) && q.rate > 0) rates[q.quote] = q.rate;
    }
    return { date: body[0]?.date, rates };
  }
  // v1: { base, date, rates: { EUR: 0.9, ... } }
  const rates = {};
  for (const [code, rate] of Object.entries(body?.rates ?? {})) {
    if (Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  return { date: body?.date, rates };
}

async function refresh() {
  for (const url of [FX_V2, FX_V1]) {
    try {
      const { date, rates } = parse(await fetchJson(url));
      if (Object.keys(rates).length < 5) throw new Error('fx: too few rates');
      const fx = { ts: Date.now(), date: date ?? '', rates: { ...rates, USD: 1 } };
      await api.storage.local.set({ fx });
      return fx;
    } catch {
      // try the next endpoint
    }
  }
  return null;
}

async function getRates() {
  const { fx } = await api.storage.local.get('fx');
  if (fx && Date.now() - fx.ts < FX_TTL) return fx;
  inflight ??= refresh().finally(() => (inflight = null));
  return (await inflight) ?? fx ?? null; // stale beats nothing
}

api.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'fx') return false;
  getRates().then(reply, () => reply(null));
  return true;
});
