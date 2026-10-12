(() => {
  'use strict';

  const TL = globalThis.TL;
  const api = globalThis.browser ?? globalThis.chrome;
  const site = TL.SITES.find((s) => s.host.test(location.hostname));
  if (!site || window.top !== window) return;

  const state = {
    cfg: { currency: 'USD', dailyBudget: 0, overrides: {}, modelBySite: {} },
    fx: null,
    learned: {},
    usage: {},
    input: null,
    ctx: 0,
    ctxKnown: false,
    undo: null,
    open: false,
    tracking: false,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Trailing debounce with a ceiling, so a page that mutates constantly
  // (streaming replies, animations) still gets updated every `maxWait` ms.
  const debounce = (fn, ms, maxWait = Infinity) => {
    let timer = 0;
    let started = 0;
    return (...args) => {
      const now = Date.now();
      if (!timer) started = now;
      clearTimeout(timer);
      const wait = Math.max(0, Math.min(ms, started + maxWait - now));
      timer = setTimeout(() => {
        timer = 0;
        fn(...args);
      }, wait);
    };
  };

  // ---------------------------------------------------------------- storage

  async function load() {
    const s = await api.storage.local.get(['cfg', 'learned', 'usage', 'fx']);
    Object.assign(state.cfg, s.cfg);
    state.learned = s.learned ?? {};
    state.usage = s.usage ?? {};
    state.fx = s.fx ?? null;
  }

  function persist(keys) {
    const out = {};
    for (const k of keys) out[k] = state[k];
    return api.storage.local.set(out);
  }

  async function pinModel(value) {
    const { cfg = {} } = await api.storage.local.get('cfg');
    cfg.modelBySite = { ...cfg.modelBySite, [site.vendor]: value };
    await api.storage.local.set({ cfg });
  }

  // ----------------------------------------------------------------- models

  const modelList = () =>
    TL.MODELS.filter((m) => m.vendor === site.vendor).map((m) => ({
      ...m,
      price: state.cfg.overrides?.[m.id] ?? m.price,
      // an edited price replaces any tier or peak schedule
      tier: state.cfg.overrides?.[m.id] ? null : m.tier,
      peak: state.cfg.overrides?.[m.id] ? null : m.peak,
    }));

  function detectModel(list) {
    const texts = [];
    for (const sel of site.model ?? []) {
      const el = document.querySelector(sel);
      if (el) texts.push(el.textContent);
    }
    if (!texts.length) {
      const roots = [composerRoot(), document.querySelector('header, [role="banner"]')];
      for (const root of roots) {
        if (!root) continue;
        for (const b of root.querySelectorAll('button, [role="button"], [role="combobox"]')) {
          const t = b.textContent.trim();
          if (t && t.length < 40) texts.push(t);
        }
      }
    }
    for (const t of texts) {
      const hit = list.find((m) => m.match.test(t));
      if (hit) return hit;
    }
    return null;
  }

  function resolveModel() {
    const list = modelList();
    const pinned = state.cfg.modelBySite?.[site.vendor];
    if (pinned) {
      const hit = list.find((m) => m.id === pinned);
      if (hit) return hit;
    }
    return detectModel(list) ?? list.find((m) => m.id === TL.DEFAULT_MODEL[site.vendor]) ?? list[0];
  }

  // ------------------------------------------------------------- page reads

  function findInput() {
    for (const sel of site.input) {
      let best = null;
      let bottom = -1;
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.bottom > bottom) {
          best = el;
          bottom = r.bottom;
        }
      }
      if (best) return best;
    }
    return null;
  }

  function composerRoot() {
    const el = state.input;
    if (!el) return null;
    const form = el.closest('form');
    if (form) return form;
    // Climb a few levels to take in the send button and toolbar, but never
    // up to the page itself, or the meter would be placed off-screen.
    let node = el;
    for (let i = 0; i < 3; i++) {
      const up = node.parentElement;
      if (!up || up === document.body || up === document.documentElement) break;
      node = up;
    }
    return node;
  }

  const isInput = (t) => state.input && (t === state.input || state.input.contains(t));

  function readInput() {
    const el = state.input;
    if (!el) return '';
    if ('value' in el) return el.value;
    // Rich editors keep each line in its own block, which innerText separates
    // with blank lines; read the blocks so a round trip keeps the text.
    const blocks = el.querySelectorAll(':scope > p, :scope > div');
    const text = blocks.length ? Array.from(blocks, (b) => b.innerText.replace(/\n$/, '')).join('\n') : el.innerText;
    return text.replace(/\u200b/g, '');
  }

  const norm = (t) => t.replace(/\u200b|\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // Replace the whole contents of the box. Returns true when it took.
  async function writeInput(text) {
    const el = state.input;
    if (!el) return false;
    if ('value' in el) {
      // React and similar frameworks track the value themselves and ignore a
      // plain assignment, so go through the native setter.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (set) set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
      return true;
    }
    const want = norm(text);
    const selectAll = async () => {
      el.focus();
      const sel = getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      // Editors such as ProseMirror copy the DOM selection into their own
      // state asynchronously; edit before that and the text lands at the old
      // cursor instead of replacing the selection.
      await sleep(60);
    };
    // 1. Typed-in text, line by line: works with editors that handle
    //    beforeinput/execCommand themselves.
    await selectAll();
    document.execCommand('delete');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (i) document.execCommand('insertParagraph');
      if (line) document.execCommand('insertText', false, line);
    });
    await sleep(80);
    if (norm(readInput()) === want) return true;
    // 2. A paste event carrying the text.
    await selectAll();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const paste = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    if (el.dispatchEvent(paste)) document.execCommand('insertText', false, text);
    await sleep(80);
    return norm(readInput()) === want;
  }

  const messageSelector = site.messages.join(',');
  const measured = new WeakMap();

  function readContext() {
    if (!messageSelector) return { tokens: 0, known: false };
    let total = 0;
    let last = null;
    let found = false;
    for (const el of document.querySelectorAll(messageSelector)) {
      if (last && last.contains(el)) continue;
      last = el;
      found = true;
      const text = el.textContent;
      const hit = measured.get(el);
      if (hit && hit.len === text.length) {
        total += hit.tokens;
        continue;
      }
      const tokens = TL.countTokens(text);
      measured.set(el, { len: text.length, tokens });
      total += tokens;
    }
    return { tokens: total, known: found };
  }

  // --------------------------------------------------------------------- ui

  const CSS = `
    :host { all: initial; position: fixed; z-index: 2147483000;
      font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      --bg: #fafaf9; --fg: #16181d; --mut: #6b7280; --line: #e4e4e0; --hover: #f0f0ed;
      --ok: #2f6f5e; --warn: #a96b0f; --bad: #b03030; --thread: #c4c7cd; }
    :host([data-theme="dark"]) { --bg: #1b1d21; --fg: #eceef1; --mut: #8b919b; --line: #32353b;
      --hover: #26292e; --ok: #6bbfa6; --warn: #d9a24a; --bad: #e07a7a; --thread: #4a4e57; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .wrap { position: relative; display: flex; justify-content: flex-end; }

    .chip { display: inline-flex; align-items: center; gap: 9px; height: 30px; padding: 0 12px 0 10px;
      border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--fg);
      font: inherit; cursor: pointer; transition: border-color .15s;
      box-shadow: 0 1px 2px rgba(22,24,29,.06), 0 4px 12px rgba(22,24,29,.05); }
    .chip:hover { border-color: var(--mut); }
    .chip:focus-visible, .btn:focus-visible, select:focus-visible { outline: 2px solid var(--ok); outline-offset: 2px; }
    .mark { width: 14px; height: 14px; flex: none; color: var(--ok); }
    .n { font-weight: 600; letter-spacing: -.01em; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .n .dim { color: var(--mut); font-weight: 400; }
    .n .unit { font-size: 11px; }
    .n.empty { color: var(--mut); font-weight: 400; letter-spacing: 0; }
    .sep { width: 1px; height: 14px; background: var(--line); }
    .cost { color: var(--mut); font-variant-numeric: tabular-nums; }

    .ticks { display: inline-flex; align-items: center; gap: 2px; }
    .ticks i { width: 2px; height: 10px; border-radius: 1px; background: var(--line); }
    .ticks.ok i.on { background: var(--ok); }
    .ticks.warn i.on { background: var(--warn); }
    .ticks.bad i.on { background: var(--bad); }
    .ticks.wide { display: flex; gap: 3px; }
    .ticks.wide i { flex: 1; width: auto; height: 12px; border-radius: 2px; }

    :host([data-flip]) .panel { bottom: auto; top: calc(100% + 8px); }
    .panel { position: absolute; right: 0; bottom: calc(100% + 8px); width: 320px; padding: 16px;
      background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: 0 2px 6px rgba(22,24,29,.06), 0 18px 48px rgba(22,24,29,.16);
      transform-origin: bottom right; animation: pop .14s ease-out;
      max-height: min(560px, var(--avail, calc(100vh - 96px))); overflow-y: auto; }
    @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.98); } }
    @media (prefers-reduced-motion: reduce) { .panel { animation: none; } .chip { transition: none; } }

    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
    .head .mark { width: 16px; height: 16px; }
    .head strong { font-size: 13px; font-weight: 600; }
    .model { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: var(--mut); }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }

    .hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .big { font-size: 30px; line-height: 1; font-weight: 650; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
    .cap { margin-top: 5px; color: var(--mut); }
    .price { text-align: right; font-variant-numeric: tabular-nums; }
    .price b { display: block; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
    .price span { color: var(--mut); }

    .stack { display: flex; gap: 2px; height: 8px; margin: 14px 0 12px; }
    .stack i { flex: 0 0 auto; min-width: 3px; border-radius: 3px; }
    .seg-thread { background: var(--thread); }
    .seg-prompt { background: var(--ok); }
    .seg-reply { background: repeating-linear-gradient(135deg, var(--ok) 0 1.5px, transparent 1.5px 4px); }
    .legend { display: grid; gap: 6px; }
    .key { display: flex; align-items: center; gap: 8px; }
    .sw { width: 8px; height: 8px; border-radius: 2px; flex: none; }
    .sw.reply { background: repeating-linear-gradient(135deg, var(--ok) 0 1px, transparent 1px 2.5px); outline: 1px solid var(--ok); outline-offset: -1px; }
    .key .k { color: var(--mut); }
    .key .v { margin-left: auto; font-weight: 500; font-variant-numeric: tabular-nums; }

    .sect { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
    .line { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .line .k { color: var(--mut); }
    .line .v { font-variant-numeric: tabular-nums; }
    .day { margin-top: 10px; margin-bottom: 0; }
    .tip { color: var(--mut); margin: 12px 0 0; }
    .tip.warn { color: var(--warn); }
    .controls { display: flex; gap: 6px; align-items: center; margin-top: 14px; }
    .fine { color: var(--mut); font-size: 11px; margin: 12px 0 0; }

    .btn { font: inherit; height: 28px; padding: 0 12px; border-radius: 8px; cursor: pointer; white-space: nowrap;
      border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
    .btn:hover:not(:disabled) { background: var(--hover); }
    .btn:disabled { color: var(--mut); cursor: default; }
    .btn.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); }
    .btn.primary:hover:not(:disabled) { background: var(--fg); opacity: .88; }
    .btn.primary:disabled { background: transparent; color: var(--mut); border-color: var(--line); }
    select { font: inherit; flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid var(--line);
      border-radius: 8px; background: var(--bg); color: var(--fg); }
  `;

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
  }

  const host = h('div', { id: 'tokenlens-root' });
  host.style.display = 'none';
  const shadow = host.attachShadow({ mode: 'open' });

  const ui = {};

  const SVG = 'http://www.w3.org/2000/svg';
  function mark() {
    const el = (tag, attrs) => {
      const n = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };
    const svg = el('svg', { viewBox: '0 0 16 16', class: 'mark', 'aria-hidden': 'true' });
    svg.append(
      el('circle', { cx: 7, cy: 7, r: 5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
      el('path', { d: 'M10.8 10.8 14 14', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      el('path', { d: 'M5.2 8.4v-1.8M7 9.2V4.8M8.8 8.6V6.2', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' }),
    );
    return svg;
  }

  const ticks = (count, cls = '') => h('span', { class: `ticks ok ${cls}` }, ...Array.from({ length: count }, () => h('i')));
  const key = (name, cls) => {
    const k = h('span', { class: 'k' }, name);
    const v = h('span', { class: 'v' });
    return { el: h('div', { class: 'key' }, h('i', { class: `sw ${cls}` }), k, v), k, v };
  };

  function build() {
    ui.n = h('span', { class: 'n' });
    ui.cost = h('span', { class: 'cost' });
    ui.sep = h('span', { class: 'sep' });
    ui.mini = ticks(8);
    ui.chip = h(
      'button',
      { class: 'chip', type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'dialog' },
      mark(),
      ui.n,
      ui.sep,
      ui.cost,
      ui.mini,
    );

    ui.modelName = h('span');
    ui.dot = h('i', { class: 'dot', title: 'Price not confirmed from an official page. Check it in the popup.', hidden: '' });
    ui.big = h('div', { class: 'big' });
    ui.price = h('b');
    ui.priceSub = h('span');
    ui.segThread = h('i', { class: 'seg-thread' });
    ui.segPrompt = h('i', { class: 'seg-prompt' });
    ui.segReply = h('i', { class: 'seg-reply' });
    ui.kThread = key('Thread so far', 'seg-thread');
    ui.kPrompt = key('Your prompt', 'seg-prompt');
    ui.kReply = key('Expected reply', 'reply');
    ui.gauge = ticks(24, 'wide');
    ui.gaugeVal = h('span', { class: 'v' });
    ui.rDay = h('div', { class: 'line day', hidden: '' }, h('span', { class: 'k' }, 'Today'), (ui.dayVal = h('span', { class: 'v' })));
    ui.model = h('select', { 'aria-label': 'Model' });
    ui.tip = h('p', { class: 'tip', hidden: '' });
    ui.trim = h('button', { class: 'btn primary', type: 'button' }, 'Trim filler');
    ui.undo = h('button', { class: 'btn', type: 'button', hidden: '' }, 'Undo');

    ui.panel = h(
      'div',
      { class: 'panel', role: 'dialog', 'aria-label': 'Tokenlens', hidden: '' },
      h('div', { class: 'head' }, mark(), h('strong', {}, 'Tokenlens'), h('span', { class: 'model' }, ui.dot, ui.modelName)),
      h(
        'div',
        { class: 'hero' },
        h('div', {}, ui.big, (ui.cap = h('div', { class: 'cap' }))),
        h('div', { class: 'price' }, ui.price, ui.priceSub),
      ),
      h('div', { class: 'stack', role: 'img', 'aria-label': 'Thread, prompt and expected reply' }, ui.segThread, ui.segPrompt, ui.segReply),
      h('div', { class: 'legend' }, ui.kThread.el, ui.kPrompt.el, ui.kReply.el),
      h(
        'div',
        { class: 'sect' },
        h('div', { class: 'line' }, h('span', { class: 'k' }, 'Context window'), ui.gaugeVal),
        ui.gauge,
        ui.rDay,
      ),
      ui.tip,
      h('div', { class: 'controls' }, ui.model, ui.trim, ui.undo),
      h('p', { class: 'fine' }, 'Estimates, not exact counts. Prices are API list rates; chat plans are not billed per token.'),
    );

    shadow.append(h('style', {}, CSS), h('div', { class: 'wrap' }, ui.panel, ui.chip));

    ui.chip.addEventListener('click', () => setOpen(!state.open));
    ui.model.addEventListener('change', () => pinModel(ui.model.value));
    ui.trim.addEventListener('click', applyTrim);
    ui.undo.addEventListener('click', undoTrim);
    // Keep focus in the chat box when clicking buttons.
    shadow.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });
  }

  function light(group, pct, started) {
    const bars = group.children;
    const lit = started ? Math.max(1, Math.round(pct * bars.length)) : 0;
    group.className = group.className.replace(/\b(ok|warn|bad)\b/, pct > 0.8 ? 'bad' : pct > 0.5 ? 'warn' : 'ok');
    for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < lit);
  }

  function fillModelSelect(current) {
    const list = modelList();
    const pinned = state.cfg.modelBySite?.[site.vendor] ?? '';
    const sig = list.map((m) => m.id).join() + '|' + current.id;
    if (ui.model.dataset.sig !== sig) {
      ui.model.replaceChildren(
        h('option', { value: '' }, `Auto · ${current.label}`),
        ...list.map((m) => h('option', { value: m.id }, m.label)),
      );
      ui.model.dataset.sig = sig;
    }
    if (ui.model.value !== pinned) ui.model.value = pinned;
  }

  function setOpen(open) {
    state.open = open;
    ui.panel.hidden = !open;
    ui.chip.setAttribute('aria-expanded', String(open));
    if (open) refresh();
  }

  function pageBackground() {
    for (let n = state.input; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (!/^rgba?\(/.test(bg)) continue;
      const c = bg.match(/[\d.]+/g).map(Number);
      if (c.length === 4 && c[3] === 0) continue; // transparent: keep looking up
      return c;
    }
    return null;
  }

  function applyTheme() {
    const c = pageBackground();
    const dark = c
      ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 < 0.5
      : matchMedia('(prefers-color-scheme: dark)').matches;
    host.dataset.theme = dark ? 'dark' : 'light';
  }

  // ---------------------------------------------------------------- compute

  const rate = () => (state.fx?.rates ?? TL.FALLBACK_FX)[state.cfg.currency] ?? 1;

  const money = (usd) => TL.fmtMoney(usd * rate(), state.cfg.currency);

  const num = (n) => Math.round(n).toLocaleString();

  function refresh() {
    if (!state.input) return;
    const model = resolveModel();
    const text = readInput();
    if (!text.trim()) state.undo = null;
    const prompt = TL.countTokens(text.trim());
    const pred = TL.predictReply(text.trim(), prompt, state.learned, model.id);
    const reply = pred.tokens;
    const sent = state.ctx + prompt;
    const total = sent + reply;
    const rate = TL.rateFor(model, sent);
    const [rateIn, rateOut] = rate.price;
    const usd = (sent * rateIn + reply * rateOut) / 1e6;
    const pct = Math.min(1, sent / model.ctx);

    const started = Boolean(prompt || state.ctx);
    ui.n.className = `n${started ? '' : ' empty'}`;
    if (prompt) {
      ui.n.replaceChildren(
        TL.fmtTokens(prompt),
        h('span', { class: 'dim' }, ' → '),
        `≈${TL.fmtTokens(total)}`,
        h('span', { class: 'dim unit' }, ' tok'),
      );
    } else if (state.ctx) {
      ui.n.replaceChildren(TL.fmtTokens(state.ctx), h('span', { class: 'dim unit' }, ' in thread'));
    } else {
      ui.n.textContent = 'Type your first prompt';
    }
    ui.cost.textContent = prompt ? money(usd) : '';
    ui.cost.hidden = ui.sep.hidden = !prompt;
    ui.mini.hidden = !started;
    light(ui.mini, pct, started);
    ui.chip.title = `${model.label} · ${num(total)} tokens this turn (reply ${num(pred.low)}–${num(pred.high)})`;

    if (!state.open) return;

    ui.modelName.textContent = rate.label ? `${model.label} · ${rate.label}` : model.label;
    ui.dot.hidden = !model.unverified;
    ui.big.textContent = prompt ? num(total) : '–';
    ui.cap.textContent = prompt ? 'tokens this turn' : 'type a prompt to estimate';
    ui.price.textContent = prompt ? money(usd) : '–';
    ui.priceSub.textContent = !prompt ? '' : state.cfg.currency === 'USD' ? 'estimated' : `${TL.fmtMoney(usd, 'USD')} USD`;

    const parts = [
      [ui.segThread, state.ctx],
      [ui.segPrompt, prompt],
      [ui.segReply, prompt ? reply : 0],
    ];
    for (const [el, v] of parts) {
      el.hidden = v <= 0;
      el.style.flexGrow = String(Math.max(v, 0));
      el.style.flexBasis = '0';
    }
    ui.kThread.v.textContent = state.ctxKnown ? num(state.ctx) : 'unavailable';
    ui.kPrompt.v.textContent = num(prompt);
    ui.kReply.k.textContent = `Expected reply · ${pred.label}`;
    ui.kReply.v.textContent = prompt ? `~${num(reply)}` : '–';
    ui.kReply.v.title = `Likely range ${num(pred.low)}–${num(pred.high)} tokens`;

    ui.gaugeVal.textContent = `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}% of ${TL.fmtTokens(model.ctx)}`;
    light(ui.gauge, pct, sent > 0);

    const budget = Number(state.cfg.dailyBudget) || 0;
    ui.rDay.hidden = !budget;
    if (budget) {
      const used = state.usage[TL.today()] ?? 0;
      ui.dayVal.textContent = `${TL.fmtTokens(used)} / ${TL.fmtTokens(budget)} tokens`;
    }

    const heavy = state.ctxKnown && state.ctx > 6000;
    ui.tip.hidden = !heavy;
    ui.tip.className = `tip${state.ctx > 40000 ? ' warn' : ''}`;
    if (heavy) {
      ui.tip.textContent = `Every message re-sends the whole thread (~${TL.fmtTokens(state.ctx)} tokens). A fresh chat for a new topic resets that.`;
    }

    const trimmed = TL.trim(text);
    const saved = trimmed.changed ? TL.countTokens(text.trim()) - TL.countTokens(trimmed.text) : 0;
    ui.trim.disabled = saved < 1;
    ui.trim.textContent = saved >= 1 ? `Trim filler · −${saved}` : prompt ? 'Already tight' : 'Trim filler';
    ui.undo.hidden = !state.undo;

    fillModelSelect(model);
  }

  async function applyTrim() {
    const original = readInput();
    const { text, changed } = TL.trim(original);
    if (!changed) return;
    if (await writeInput(text)) state.undo = original;
    else copyFallback(text);
    setTimeout(refresh, 50);
  }

  async function undoTrim() {
    if (state.undo == null) return;
    const original = state.undo;
    if (await writeInput(original)) state.undo = null;
    else copyFallback(original);
    setTimeout(refresh, 50);
  }

  function flash(msg) {
    ui.trim.textContent = msg;
    setTimeout(refresh, 2200);
  }

  // The editor refused the edit: put the text on the clipboard instead.
  function copyFallback(text) {
    navigator.clipboard?.writeText(text).then(
      () => flash('Copied, paste it in'),
      () => flash("Couldn't edit this box"),
    );
  }

  // -------------------------------------------------------- usage tracking

  async function addUsage(tokens) {
    const day = TL.today();
    state.usage[day] = (state.usage[day] ?? 0) + Math.round(tokens);
    // Keep a rolling window so storage stays small.
    const keep = Object.keys(state.usage).sort().slice(-31);
    state.usage = Object.fromEntries(keep.map((k) => [k, state.usage[k]]));
    await persist(['usage']);
    if (state.open) refresh();
  }

  async function learnReply(modelId, pred, tokens) {
    if (tokens < 5 || tokens > 60000) return;
    TL.learnReply(state.learned, modelId, pred.kind, pred.prior, tokens);
    await persist(['learned']);
  }

  async function onSend() {
    if (state.tracking) return;
    const text = readInput().trim();
    if (!text) return;
    const prompt = TL.countTokens(text);
    const model = resolveModel();
    const pred = TL.predictReply(text, prompt, state.learned, model.id);
    const before = readContext();
    state.undo = null;
    state.tracking = true;

    try {
      // Enter and clicks do not always send (a reply may be streaming, the
      // key may add a newline). A message only counts once the box empties.
      await sleep(700);
      state.input = findInput() ?? state.input;
      if (readInput().trim()) return;

      if (!before.known) {
        await addUsage(prompt);
        return;
      }

      const sent = before.tokens + prompt;
      let last = -1;
      let stable = 0;
      let grew = false;
      for (let i = 0; i < 120; i++) {
        await sleep(1500);
        const now = readContext().tokens;
        if (!grew && now > before.tokens) {
          grew = true;
          await addUsage(sent);
        }
        if (!grew && i >= 6) return; // the page never showed the message
        stable = now === last ? stable + 1 : 0;
        last = now;
        if (grew && stable >= 3) break;
      }
      if (grew) {
        const reply = Math.max(0, last - sent);
        await addUsage(reply);
        await learnReply(model.id, pred, reply);
      }
    } finally {
      state.tracking = false;
    }
  }

  // ------------------------------------------------------------- placement

  let placing = false;
  let watched = null;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
  function place() {
    if (placing) return;
    placing = true;
    requestAnimationFrame(() => {
      placing = false;
      const root = composerRoot();
      if (!root || !root.isConnected) return;
      const r = root.getBoundingClientRect();
      host.style.right = `${Math.max(8, innerWidth - r.right)}px`;
      const bottom = Math.max(8, innerHeight - r.top + 6);
      host.style.bottom = `${bottom}px`;
      // Room for the panel. Above the chip normally; when a tall composer
      // pushes the chip near the top of the window, open it downward instead.
      const above = innerHeight - bottom - 40;
      const below = bottom - 8;
      const flip = above < 300 && below > above;
      host.toggleAttribute('data-flip', flip);
      host.style.setProperty('--avail', `${Math.max(160, (flip ? below : above) - 12)}px`);
      if (ro && watched !== root) {
        ro.disconnect();
        ro.observe(root);
        if (state.input) ro.observe(state.input);
        watched = root;
      }
    });
  }

  const sync = debounce(() => {
    state.input = findInput();
    const visible = Boolean(state.input);
    host.style.display = visible ? '' : 'none';
    if (!visible) return;
    const ctx = readContext();
    state.ctx = ctx.tokens;
    state.ctxKnown = ctx.known;
    applyTheme();
    refresh();
    place();
  }, 350, 1200);

  const onType = debounce(() => {
    refresh();
    place();
  }, 120);

  // ------------------------------------------------------------------- boot

  async function boot() {
    await load();
    build();
    document.documentElement.append(host);

    api.runtime
      .sendMessage({ type: 'fx' })
      .then((fx) => {
        if (fx) {
          state.fx = fx;
          refresh();
        }
      })
      .catch(() => {});

    api.storage.onChanged.addListener((changes) => {
      if (changes.cfg) Object.assign(state.cfg, changes.cfg.newValue);
      if (changes.fx) state.fx = changes.fx.newValue;
      if (changes.usage) state.usage = changes.usage.newValue ?? {};
      if (changes.learned) state.learned = changes.learned.newValue ?? {};
      refresh();
    });

    document.addEventListener('input', (e) => isInput(e.target) && onType(), true);

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && state.open) setOpen(false);
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && isInput(e.target)) onSend();
      },
      true,
    );

    document.addEventListener(
      'click',
      (e) => {
        if (e.composedPath().includes(host)) return;
        if (state.open) setOpen(false);
        const btn = e.target.closest?.('button, [role="button"]');
        if (btn && site.send.some((sel) => btn.matches(sel))) onSend();
      },
      true,
    );

    new MutationObserver(sync).observe(document.body, { childList: true, subtree: true, characterData: true });
    // Sites switch theme by changing an attribute on <html> or <body>.
    const themeAttrs = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode', 'data-color-scheme'] };
    new MutationObserver(sync).observe(document.documentElement, themeAttrs);
    new MutationObserver(sync).observe(document.body, themeAttrs);
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', sync);
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    sync();
  }

  boot();
})();
