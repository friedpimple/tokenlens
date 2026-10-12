// Run with: node scripts/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Intl, Date });
ctx.globalThis = ctx;
for (const f of ['data', 'estimate', 'predict', 'trim', 'sites']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', `${f}.js`), 'utf8'), ctx, { filename: `${f}.js` });
}
const { TL } = ctx;

let passed = 0;
// Arrays made inside the vm context have a different prototype, so compare by value.
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

test('countTokens: plain sentence', () => {
  assert.strictEqual(TL.countTokens('The quick brown fox jumps over the lazy dog.'), 10);
});
test('countTokens: empty and whitespace', () => {
  assert.strictEqual(TL.countTokens(''), 0);
  assert.strictEqual(TL.countTokens('   '), 0);
});
test('countTokens: contractions, numbers, CJK', () => {
  assert.strictEqual(TL.countTokens("don't"), 2);
  assert.strictEqual(TL.countTokens('2026'), 2);
  assert.strictEqual(TL.countTokens('こんにちは'), 5);
});
test('countTokens: long words split', () => {
  assert.ok(TL.countTokens('internationalization') >= 4);
});
test('countTokens: CJK touching Latin text is counted in full', () => {
  assert.strictEqual(TL.countTokens('hello世界'), TL.countTokens('hello 世界'));
});
test('countTokens: scales roughly with length', () => {
  const para = 'Large language models read text as tokens, and every message in a thread is sent again. '.repeat(50);
  const n = TL.countTokens(para);
  assert.ok(n > para.length / 6 && n < para.length / 3, `got ${n} for ${para.length} chars`);
});

test('trim: strips greeting, polite opener, filler, sign-off', () => {
  const r = TL.trim('Hi Claude, could you please help me write a function that basically sorts a list? Thanks in advance!!');
  assert.strictEqual(r.text, 'Help me write a function that sorts a list?');
});
test('trim: leaves code, inline code and URLs alone', () => {
  const src = 'please run `basically  please` on https://example.com/please and\n```\nplease   keep   this\n```';
  const r = TL.trim(src);
  assert.ok(r.text.includes('`basically  please`'));
  assert.ok(r.text.includes('https://example.com/please'));
  assert.ok(r.text.includes('please   keep   this'));
});
test('trim: does not rewrite meaningful "can you" mid-sentence', () => {
  const r = TL.trim('What can you do with a 128k context window?');
  assert.strictEqual(r.text, 'What can you do with a 128k context window?');
});
test('trim: collapses stray punctuation and blank lines, keeps repeated lines', () => {
  const r = TL.trim('Fix this bug!!!   now\n\n\n\nFix this bug!!!   now\nnext line');
  assert.strictEqual(r.text, 'Fix this bug! now\n\nFix this bug! now\nnext line');
});
test('trim: never alters unfenced code (indentation, repeated braces)', () => {
  const code = 'fix this:\nfunction a() {\n  if (x) {\n    y();\n  }\n}\n\n}\n}';
  assert.strictEqual(TL.trim(code).text, code);
});
test('trim: only drops "can you" before a request verb', () => {
  assert.strictEqual(TL.trim('Can you read PDFs?').changed, false);
  assert.strictEqual(TL.trim('Would you rather live by the sea?').changed, false);
  assert.strictEqual(TL.trim('Can you write me a poem about rain').text, 'Write me a poem about rain');
});
test('trim: leaves words that carry an instruction', () => {
  for (const t of ['Explain it simply', 'Translate this literally', "Don't please everyone", 'It is actually safe, right?']) {
    assert.strictEqual(TL.trim(t).changed, false, t);
  }
});
test('trim: phrase swaps', () => {
  assert.strictEqual(TL.trim('We did it in order to learn, due to the fact that it matters.').text,
    'We did it to learn, because it matters.');
});
test('trim: already tight text is unchanged', () => {
  assert.strictEqual(TL.trim('Summarise the attached report in five bullets.').changed, false);
});
test('trim: never increases token count', () => {
  const samples = [
    'Hello there! I was wondering if you could please explain, basically, how closures work. Thank you so much!',
    'I would like you to review my code and, you know, tell me what is wrong.',
    'x = 1   \n\n\n\n y = 2',
  ];
  for (const s of samples) {
    assert.ok(TL.countTokens(TL.trim(s).text) <= TL.countTokens(s), s);
  }
});
test('trim: keeps "thanks" and filler words that are the subject', () => {
  for (const t of ['How do I say thank you', 'Translate to French: thanks a lot', 'Thanks', "What does the word 'honestly' mean?", 'How do I use basically in a sentence?']) {
    assert.strictEqual(TL.trim(t).changed, false, t);
  }
  assert.strictEqual(TL.trim('Fix my essay. Thanks!').text, 'Fix my essay.');
});

const predict = (t, l = {}, m = 'm') => TL.predictReply(t, TL.countTokens(t), l, m);
test('predict: reply length depends on the request', () => {
  const hi = predict('hi').tokens;
  const q = predict('What is the capital of France?').tokens;
  const code = predict('Write a python function that parses a csv file').tokens;
  const essay = predict('Write an essay about the causes of the French Revolution').tokens;
  assert.ok(hi < q && q < code && q < essay, [hi, q, code, essay].join());
});
test('predict: explicit length requests are honoured', () => {
  assert.ok(Math.abs(predict('Explain DNS in 100 words').tokens - 135) <= 2);
  assert.strictEqual(predict('Give me 5 bullet points on sleep').kind, 'explicit');
  assert.ok(predict('Summarise this in one sentence').tokens < 40);
});
test('predict: numbers about the input are not length requests', () => {
  assert.notStrictEqual(predict('Summarise these 5 paragraphs for me').kind, 'explicit');
  assert.notStrictEqual(predict('I have 2 sentences I need translated').kind, 'explicit');
  assert.strictEqual(predict('Write a 500-word essay on rivers').kind, 'explicit');
  assert.strictEqual(predict('Explain it in a couple of sentences').tokens, 56);
});
test('predict: numbers with thousands separators', () => {
  assert.strictEqual(predict('Write an essay in 1,000 words about rivers').tokens, 1350);
  assert.strictEqual(predict('Write a 1,500-word essay about rivers').tokens, 2025);
});
test('predict: brief and detailed modifiers', () => {
  assert.ok(predict('Briefly explain how DNS works').tokens < predict('Explain how DNS works').tokens);
  assert.ok(predict('Explain how DNS works in detail').tokens > predict('Explain how DNS works').tokens);
});
test('predict: summaries scale with the input', () => {
  const small = predict('summarize: ' + 'word '.repeat(200)).tokens;
  const big = predict('summarize: ' + 'word '.repeat(2000)).tokens;
  assert.ok(big > small);
});
test('predict: learns a verbose model and a repeated kind', () => {
  const learned = {};
  const p = predict('Explain how DNS works', learned, 'g');
  for (let i = 0; i < 4; i++) TL.learnReply(learned, 'g', p.kind, p.prior, 1500);
  const after = predict('Explain how TCP works', learned, 'g');
  assert.ok(after.tokens > p.tokens * 2, `${p.tokens} -> ${after.tokens}`);
  assert.ok(after.low < after.tokens && after.tokens < after.high);
});
test('predict: several asks and long prompts get fuller replies', () => {
  const one = predict('Why is the sky blue?').tokens;
  const three = predict('Why is the sky blue? Why is the sea blue? Why are sunsets red?').tokens;
  assert.ok(three > one * 1.5, `${one} -> ${three}`);
  const short = predict('Explain how caching works').tokens;
  const long = predict('Explain how caching works in our service. ' + 'We have a web tier, an API tier and a database, and requests vary a lot between users. '.repeat(8)).tokens;
  assert.ok(long > short, `${short} -> ${long}`);
  const list = predict('Compare these:\n1. cats\n2. dogs\n3. birds').tokens;
  assert.ok(list > predict('Compare cats').tokens);
});
test('predict: follow-ups track the previous reply', () => {
  const tp = (t, last) => TL.predictReply(t, TL.countTokens(t), {}, 'm', last);
  assert.strictEqual(tp('continue', 800).kind, 'followup');
  assert.strictEqual(tp('continue', 800).tokens, 800);
  assert.strictEqual(tp('make it shorter', 800).tokens, 400);
  assert.ok(tp('continue', 0).tokens > 0);
  assert.notStrictEqual(tp('continue the story about the dragon and the knight', 800).kind, 'followup');
});
test('predict: consistent replies narrow the range, erratic ones widen it', () => {
  const steady = {};
  const erratic = {};
  const p = predict('Explain how DNS works', {}, 'g');
  for (const v of [500, 510, 495, 505, 500]) TL.learnReply(steady, 'g', p.kind, p.prior, v);
  for (const v of [100, 1500, 150, 1200, 90]) TL.learnReply(erratic, 'g', p.kind, p.prior, v);
  const a = predict('Explain how DNS works', steady, 'g');
  const b = predict('Explain how DNS works', erratic, 'g');
  assert.ok(a.high / a.low < b.high / b.low, `${a.low}-${a.high} vs ${b.low}-${b.high}`);
  assert.ok(Math.abs(a.tokens - 500) < 100, a.tokens);
});
test('predict: ignores legacy numeric learned values', () => {
  assert.ok(predict('hello world question?', { m: 350 }).tokens > 0);
});

test('models: ChatGPT labels map to the right model', () => {
  const pick = (label) => TL.MODELS.filter((m) => m.vendor === 'openai').find((m) => m.match.test(label))?.id;
  assert.strictEqual(pick('GPT-5.6 Luna'), 'gpt-56-luna');
  assert.strictEqual(pick('GPT-5.6 Sol'), 'gpt-56-sol');
  assert.strictEqual(pick('GPT-6.1 Sol'), 'gpt-sol');
  assert.strictEqual(pick('Luna'), 'gpt-luna');
});
test('models: every vendor has a default that exists', () => {
  const ids = new Set(TL.MODELS.map((m) => m.id));
  for (const id of Object.values(TL.DEFAULT_MODEL)) assert.ok(ids.has(id), id);
  assert.strictEqual(ids.size, TL.MODELS.length, 'duplicate model id');
});
test('models: UI words do not trigger a model match', () => {
  const noise = ['Projects', 'Profile', 'Prompt', 'Pro', 'Auto', 'Mistral AI', 'Share', 'New chat', 'Library', 'Settings'];
  for (const m of TL.MODELS) {
    if (m.vendor === 'gemini' || m.vendor === 'deepseek' || m.vendor === 'grok' || m.vendor === 'claude') continue;
    for (const w of noise) assert.ok(!m.match.test(w), `${m.id} matched "${w}"`);
  }
});
test('models: names the sites show map to the right model', () => {
  const pick = (vendor, text) => TL.MODELS.find((m) => m.vendor === vendor && m.match.test(text))?.id;
  assert.strictEqual(pick('claude', 'Sonnet 5.5'), 'claude-sonnet');
  assert.strictEqual(pick('claude', 'Opus 5.5'), 'claude-opus');
  assert.strictEqual(pick('gemini', '2.5 Flash-Lite'), 'gemini-lite');
  assert.strictEqual(pick('gemini', 'Flash'), 'gemini-flash');
  assert.strictEqual(pick('perplexity', 'Sonar Pro'), 'sonar-pro');
});
test('models: prices, windows and tiers are well formed', () => {
  for (const m of TL.MODELS) {
    assert.ok(m.price.length === 2 && m.price.every((n) => n > 0), m.id);
    assert.ok(m.ctx >= 100000, m.id);
    if (m.peak) assert.ok(m.peak.off[0] < m.price[0] && m.peak.hours.length, m.id);
    if (m.tier) assert.ok(m.tier.over > 0 && m.tier.price.length === 2 && m.tier.price[0] > m.price[0], m.id);
  }
});
test('models: OpenAI and DeepSeek names resolve', () => {
  const pick = (vendor, text) => TL.MODELS.find((m) => m.vendor === vendor && m.match.test(text))?.id;
  assert.strictEqual(pick('openai', 'GPT-6 Astra'), 'gpt-astra');
  assert.strictEqual(pick('openai', 'GPT-6.1 Sol'), 'gpt-sol');
  assert.strictEqual(pick('deepseek', 'DeepSeek V4 Pro'), 'deepseek-pro');
  assert.strictEqual(pick('deepseek', 'DeepSeek'), 'deepseek-flash');
});
test('rates: DeepSeek peak and off-peak follow the UTC clock', () => {
  const flash = TL.MODELS.find((m) => m.id === 'deepseek-flash');
  const at = (d, h) => TL.rateFor(flash, 0, new Date(Date.UTC(2026, 9, d, h, 30)));
  same(at(13, 2).price, [0.3, 1.2]); // Tue 02:30 peak
  same(at(13, 7).price, [0.3, 1.2]); // Tue 07:30 peak
  same(at(13, 5).price, [0.15, 0.6]); // Tue 05:30 gap
  same(at(13, 10).price, [0.15, 0.6]); // window ends at 10:00
  same(at(13, 0).price, [0.15, 0.6]);
  same(at(17, 2).price, [0.15, 0.6]); // Saturday
  same(at(12, 9).price, [0.3, 1.2]); // Monday 09:30 peak
});
test('rates: long-prompt tiers apply above the threshold only', () => {
  const haiku = TL.MODELS.find((m) => m.id === 'claude-haiku');
  same(TL.rateFor(haiku, 100000).price, [0.1, 0.5]);
  same(TL.rateFor(haiku, 100001).price, [0.5, 2.5]);
  const pro = TL.MODELS.find((m) => m.id === 'gemini-pro');
  same(TL.rateFor(pro, 250000).price, [4, 18]);
  same(TL.rateFor(TL.MODELS.find((m) => m.id === 'claude-sonnet'), 900000).price, [2, 10]);
});
test('dayKey is stable and zero padded', () => {
  assert.strictEqual(TL.dayKey(new Date(2026, 0, 5)), '2026-01-05');
});
test('models: every site vendor has models', () => {
  for (const s of TL.SITES) {
    assert.ok(TL.MODELS.some((m) => m.vendor === s.vendor), s.vendor);
  }
});
test('format helpers', () => {
  assert.strictEqual(TL.fmtTokens(950), '950');
  assert.strictEqual(TL.fmtTokens(1200), '1.2k');
  assert.strictEqual(TL.fmtTokens(48200), '48k');
  assert.strictEqual(TL.fmtTokens(1500000), '1.5M');
  assert.strictEqual(TL.fmtTokens(999.6), '1k');
  assert.strictEqual(TL.fmtTokens(9960), '10k');
  assert.strictEqual(TL.fmtTokens(999600), '1M');
  assert.ok(/0\.0041/.test(TL.fmtMoney(0.00412, 'USD')));
});

test('manifest: every referenced file exists', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const files = [
    ...Object.values(m.icons),
    m.action.default_popup,
    m.background.service_worker,
    ...m.background.scripts,
    ...m.content_scripts.flatMap((c) => c.js),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
});

test('manifest: store limits and required fields', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.manifest_version, 3);
  assert.ok(m.name.length <= 45, 'name too long');
  assert.ok(m.description.length <= 132, 'description over the Chrome Web Store limit');
  assert.ok(/^\d+\.\d+\.\d+$/.test(m.version));
  assert.ok(m.permissions.every((p) => p === 'storage'), 'unexpected permission');
  assert.ok(m.content_scripts[0].matches.every((u) => u.startsWith('https://')), 'non-https match');
  const sites = new Set(TL.SITES.map((x) => x.vendor));
  assert.ok(m.content_scripts[0].matches.length >= sites.size);
});

console.log(`\n${passed} passed`);

require('child_process').execFileSync('node', [path.join(__dirname, 'test-background.js')], { stdio: 'inherit' });
