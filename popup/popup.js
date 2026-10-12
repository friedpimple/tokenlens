const api = globalThis.browser ?? globalThis.chrome;
const TL = globalThis.TL;
const $ = (sel) => document.querySelector(sel);

const state = { cfg: { currency: 'USD', dailyBudget: 0, overrides: {}, modelBySite: {} }, fx: null, usage: {} };
let flashTimer;

function flash(text) {
  $('#status').textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($('#status').textContent = ''), 1400);
}

// Applies `patch` on top of the stored settings, not the copy loaded when the
// popup opened, so a model picked on the page meanwhile is not overwritten.
async function save(patch) {
  const { cfg } = await api.storage.local.get('cfg');
  Object.assign(state.cfg, cfg, patch);
  await api.storage.local.set({ cfg: state.cfg });
  flash('Saved');
}

function renderChart() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: TL.dayKey(d), label: d.toLocaleDateString(undefined, { weekday: 'narrow' }) });
  }
  const values = days.map((d) => state.usage[d.key] ?? 0);
  const max = Math.max(...values, 1);
  $('#chart').replaceChildren(
    ...days.map((d, i) => {
      const bar = document.createElement('div');
      bar.className = `bar${i === 6 ? ' today' : ''}`;
      bar.title = `${d.key}: ${values[i].toLocaleString()} tokens`;
      const fill = document.createElement('i');
      fill.style.height = `${Math.max(3, (values[i] / max) * 48)}px`;
      bar.append(fill, d.label);
      return bar;
    }),
  );
  const today = values[6];
  $('#today').textContent = today
    ? `Today: ${today.toLocaleString()} tokens (estimated)`
    : 'Nothing recorded today yet.';
}

function renderCurrency() {
  const codes = Object.keys(state.fx?.rates ?? TL.FALLBACK_FX).sort();
  const select = $('#currency');
  select.replaceChildren(
    ...codes.map((c) => {
      const o = document.createElement('option');
      o.value = o.textContent = c;
      return o;
    }),
  );
  select.value = state.cfg.currency;
  $('#fxnote').textContent = state.fx
    ? `Rates from ${state.fx.date}, refreshed daily.`
    : 'Using approximate built-in rates until a live fetch succeeds.';
}

const VENDORS = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', deepseek: 'DeepSeek', grok: 'Grok', perplexity: 'Perplexity', mistral: 'Mistral' };

function renderPrices() {
  $('#unverified-note').hidden = !TL.MODELS.some((m) => m.unverified);
  const root = $('#prices');
  root.replaceChildren();
  let vendor = '';
  for (const m of TL.MODELS) {
    if (m.vendor !== vendor) {
      vendor = m.vendor;
      const v = document.createElement('div');
      v.className = 'vendor';
      v.textContent = VENDORS[vendor] ?? vendor;
      root.append(v);
    }
    const name = document.createElement('span');
    name.textContent = (m.peak ? `${m.label} (peak)` : m.label) + (m.unverified ? ' *' : '');
    if (m.unverified) name.title = 'Could not be confirmed from an official pricing page. Check and edit.';
    const current = state.cfg.overrides?.[m.id] ?? m.price;
    const inputs = [0, 1].map((idx) => {
      const el = document.createElement('input');
      el.type = 'number';
      el.min = '0';
      el.step = 'any';
      el.value = current[idx];
      el.setAttribute('aria-label', `${m.label} ${idx ? 'output' : 'input'} price`);
      el.addEventListener('change', () => {
        // An emptied box means nothing was entered, not a price of 0.
        const next = inputs.map((i) => (i.value.trim() === '' ? NaN : Number(i.value)));
        if (next.some((n) => !Number.isFinite(n) || n < 0)) {
          // Put the saved values back in place. Rebuilding the list here would
          // remove the box while it is losing focus, which throws.
          const saved = state.cfg.overrides?.[m.id] ?? m.price;
          inputs.forEach((i, idx) => (i.value = saved[idx]));
          return;
        }
        const overrides = { ...state.cfg.overrides };
        if (next[0] === m.price[0] && next[1] === m.price[1]) delete overrides[m.id];
        else overrides[m.id] = next;
        save({ overrides });
      });
      return el;
    });
    root.append(name, ...inputs);
  }
}

async function init() {
  const stored = await api.storage.local.get(['cfg', 'fx', 'usage']);
  Object.assign(state.cfg, stored.cfg);
  state.fx = stored.fx ?? null;
  state.usage = stored.usage ?? {};

  renderChart();
  renderCurrency();
  renderPrices();
  $('#budget').value = state.cfg.dailyBudget || '';

  $('#currency').addEventListener('change', (e) => {
    save({ currency: e.target.value });
  });
  $('#budget').addEventListener('change', (e) => {
    save({ dailyBudget: Math.max(0, Math.round(Number(e.target.value) || 0)) });
  });
  $('#reset-prices').addEventListener('click', () => {
    state.cfg.overrides = {};
    renderPrices();
    save({ overrides: {} });
  });
  $('#reset-learned').addEventListener('click', async () => {
    await api.storage.local.set({ learned: {} });
    flash('Cleared');
  });

  if (!state.fx) {
    const fx = await api.runtime.sendMessage({ type: 'fx' }).catch(() => null);
    if (fx) {
      state.fx = fx;
      renderCurrency();
    }
  }
}

init();
