// Exercises src/background.js against a mocked fetch and extension API.
// Run with: node scripts/test-background.js (also run by scripts/test.js)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8');

function env({ routes, stored = {} }) {
  const store = { ...stored };
  const calls = [];
  let listener;
  const chrome = {
    storage: {
      local: {
        get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : { ...store }),
        set: async (o) => Object.assign(store, o),
      },
    },
    runtime: { onMessage: { addListener: (fn) => (listener = fn) } },
  };
  const fetch = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error('network down');
    return { ok: r.ok !== false, status: r.status ?? 200, json: async () => r.body };
  };
  vm.runInNewContext(code, { chrome, fetch, Date, Object, Number, Array, Promise, Math, console });
  const ask = () => new Promise((resolve) => listener({ type: 'fx' }, {}, resolve));
  return { ask, calls, store };
}

const V2 = 'https://api.frankfurter.dev/v2/rates?base=USD';
const V1 = 'https://api.frankfurter.dev/v1/latest?base=USD';
const v2body = ['AUD', 'EUR', 'GBP', 'JPY', 'CAD', 'NZD'].map((q, i) => ({ date: '2026-10-11', base: 'USD', quote: q, rate: [1.43, 0.89, 0.75, 158, 1.42, 1.78][i] }));
const v1body = { amount: 1, base: 'USD', date: '2026-10-09', rates: { AUD: 1.43, EUR: 0.89, GBP: 0.75, JPY: 158, CAD: 1.42, NZD: 1.78 } };

let n = 0;
const test = async (name, fn) => {
  await fn();
  n++;
  console.log(`  ok  ${name}`);
};

(async () => {
  console.log('background:');
  await test('reads the v2 array format', async () => {
    const e = env({ routes: { [V2]: { body: v2body } } });
    const fx = await e.ask();
    assert.strictEqual(fx.rates.AUD, 1.43);
    assert.strictEqual(fx.rates.USD, 1);
    assert.strictEqual(fx.date, '2026-10-11');
    assert.deepStrictEqual(e.calls, [V2]);
    assert.ok(e.store.fx, 'cached');
  });
  await test('falls back to v1 when v2 fails', async () => {
    const e = env({ routes: { [V2]: { ok: false, status: 500 }, [V1]: { body: v1body } } });
    const fx = await e.ask();
    assert.strictEqual(fx.rates.EUR, 0.89);
    assert.deepStrictEqual(e.calls, [V2, V1]);
  });
  await test('rejects junk responses', async () => {
    const e = env({ routes: { [V2]: { body: [{ quote: 'AUD', rate: 'x' }] }, [V1]: { body: { rates: { AUD: -1 } } } } });
    assert.strictEqual(await e.ask(), null);
  });
  await test('returns null when offline with no cache', async () => {
    assert.strictEqual(await env({ routes: {} }).ask(), null);
  });
  await test('serves stale rates when offline', async () => {
    const stale = { ts: 1, date: 'old', rates: { USD: 1, AUD: 1.5 } };
    const e = env({ routes: {}, stored: { fx: stale } });
    assert.strictEqual((await e.ask()).rates.AUD, 1.5);
  });
  await test('does not refetch while the cache is fresh', async () => {
    const fresh = { ts: Date.now(), date: 'today', rates: { USD: 1, AUD: 1.5 } };
    const e = env({ routes: { [V2]: { body: v2body } }, stored: { fx: fresh } });
    await e.ask();
    assert.strictEqual(e.calls.length, 0);
  });
  await test('concurrent requests share one fetch', async () => {
    const e = env({ routes: { [V2]: { body: v2body } } });
    await Promise.all([e.ask(), e.ask(), e.ask()]);
    assert.strictEqual(e.calls.length, 1);
  });
  console.log(`${n} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
