(() => {
  const TL = (globalThis.TL ??= {});

  // Prices are USD per 1M tokens, [input, output], checked against each
  // provider's own pricing page on 2026-10-12. `ctx` is the context window in
  // tokens. Entries marked `unverified` could not be confirmed from an
  // official page, so the popup lets you override any of them.
  TL.PRICES_CHECKED = '2026-10-12';

  TL.MODELS = [
    // Claude. 1M context applies to 4.6 and later except Haiku 5.5, whose
    // window was not stated (200k assumed for the gauge only). Haiku 5.5 is
    // priced by prompt length: the `tier` rate applies above 100k tokens.
    { id: 'claude-fable',  vendor: 'claude', label: 'Claude Fable',  price: [10, 50],  ctx: 1000000, match: /fable|mythos/i },
    { id: 'claude-opus',   vendor: 'claude', label: 'Claude Opus',   price: [4, 20],   ctx: 1000000, match: /opus/i },
    { id: 'claude-sonnet', vendor: 'claude', label: 'Claude Sonnet', price: [2, 10],   ctx: 1000000, match: /sonnet/i },
    { id: 'claude-haiku',  vendor: 'claude', label: 'Claude Haiku',  price: [0.1, 0.5], tier: { over: 100000, price: [0.5, 2.5] }, ctx: 200000, match: /haiku/i },

    // OpenAI. GPT-6 family, 1.05M context, from OpenAI's models page.
    { id: 'gpt-astra', vendor: 'openai', label: 'GPT-6 Astra', price: [10, 50], ctx: 1050000, match: /\bastra\b/i },
    { id: 'gpt-sol',   vendor: 'openai', label: 'GPT-6.1 Sol', price: [2, 10],  ctx: 1050000, match: /\bsol\b/i },
    { id: 'gpt-luna',  vendor: 'openai', label: 'GPT-6 Luna',  price: [0.1, 0.5], ctx: 1050000, match: /\bluna\b/i },

    // Gemini. Context window not stated on the pricing page (1M assumed).
    // Flash rates are a launch discount that doubles on 2027-01-01. Pro costs
    // more for prompts over 200k tokens (the `tier` rate).
    { id: 'gemini-pro',   vendor: 'gemini', label: 'Gemini Pro',        price: [2, 12],     tier: { over: 200000, price: [4, 18] }, ctx: 1000000, match: /\bpro\b|thinking/i },
    { id: 'gemini-flash', vendor: 'gemini', label: 'Gemini Flash',      price: [0.75, 3.75], ctx: 1000000, match: /flash(?![\s-]*lite)|\bfast\b/i },
    { id: 'gemini-lite',  vendor: 'gemini', label: 'Gemini Flash-Lite', price: [0.3, 2.5],  ctx: 1000000, match: /lite/i },

    // DeepSeek, from its own pricing page. `price` is the peak rate; `peak`
    // holds the schedule and the off-peak rate (half). Peak is Mon-Fri,
    // 01:00-04:00 and 06:00-10:00 UTC. Chinese public holidays are off-peak all
    // day and are not modelled, so on those days the cost is slightly high.
    { id: 'deepseek-pro',   vendor: 'deepseek', label: 'DeepSeek V4 Pro',   price: [1.32, 3.96], peak: { days: [1, 2, 3, 4, 5], hours: [[1, 4], [6, 10]], off: [0.66, 1.98] }, ctx: 1000000, match: /\bpro\b/i },
    { id: 'deepseek-flash', vendor: 'deepseek', label: 'DeepSeek V4 Flash', price: [0.3, 1.2],   peak: { days: [1, 2, 3, 4, 5], hours: [[1, 4], [6, 10]], off: [0.15, 0.6] }, ctx: 1000000, match: /deepseek|flash|\bv3|\bv4|\br1\b/i },

    { id: 'grok', vendor: 'grok', label: 'Grok', price: [2, 6], ctx: 500000, match: /grok/i },

    // Perplexity also charges a per-request fee, which is not included here.
    // Context windows for Perplexity and Mistral are assumed (128k).
    { id: 'sonar-pro', vendor: 'perplexity', label: 'Sonar Pro',    price: [3, 15], ctx: 128000, match: /sonar[\s-]*(?:pro|reasoning|deep)/i },
    { id: 'sonar',     vendor: 'perplexity', label: 'Sonar',        price: [1, 1],  ctx: 128000, match: /sonar|perplexity/i },

    // Mistral. Context windows not stated (128k assumed). Large 4 is on
    // sale at $0.68 / $2.09; list price is used here.
    { id: 'mistral-large',  vendor: 'mistral', label: 'Mistral Large',  price: [1.36, 4.18], ctx: 128000, match: /large/i },
    { id: 'mistral-medium', vendor: 'mistral', label: 'Mistral Medium', price: [1.5, 7.5],   ctx: 128000, match: /medium/i },
    { id: 'mistral-small',  vendor: 'mistral', label: 'Mistral Small',  price: [0.15, 0.6],  ctx: 128000, match: /\bsmall\b/i },
  ];

  TL.DEFAULT_MODEL = {
    claude: 'claude-sonnet',
    openai: 'gpt-sol',
    gemini: 'gemini-pro',
    deepseek: 'deepseek-flash',
    grok: 'grok',
    perplexity: 'sonar',
    mistral: 'mistral-medium',
  };

  // Used only until the first live exchange-rate fetch succeeds.
  TL.FALLBACK_FX = {
    USD: 1, EUR: 0.92, GBP: 0.78, AUD: 1.52, CAD: 1.38, NZD: 1.68,
    JPY: 150, CNY: 7.2, INR: 84, CHF: 0.88, SGD: 1.34, BRL: 5.5,
  };

  // The USD rates [input, output] that apply right now: DeepSeek's peak or
  // off-peak rate by UTC clock, or a long-prompt tier, else the base price.
  TL.rateFor = (m, promptTokens, now = new Date()) => {
    if (m.peak) {
      const h = now.getUTCHours();
      const peak = m.peak.days.includes(now.getUTCDay()) && m.peak.hours.some(([from, to]) => h >= from && h < to);
      return { price: peak ? m.price : m.peak.off, label: peak ? 'peak rate' : 'off-peak rate' };
    }
    if (m.tier && promptTokens > m.tier.over) return { price: m.tier.price, label: 'long prompt' };
    return { price: m.price, label: '' };
  };

  // Local calendar day as YYYY-MM-DD. Built by hand so the format never
  // depends on the browser's locale data.
  TL.dayKey = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  TL.today = () => TL.dayKey();

  TL.fmtTokens = (n) => {
    if (n < 1000) return String(Math.round(n));
    if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (n < 1e6) return Math.round(n / 1000) + 'k';
    return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  };

  TL.fmtMoney = (value, currency) => {
    const small = Math.abs(value) < 1;
    const opts = small
      ? { style: 'currency', currency, maximumSignificantDigits: 2 }
      : { style: 'currency', currency };
    try {
      return new Intl.NumberFormat(undefined, opts).format(value);
    } catch {
      return `${currency} ${value.toFixed(small ? 4 : 2)}`;
    }
  };
})();
