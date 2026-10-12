(() => {
  const TL = (globalThis.TL ??= {});

  // Predicts how long the model's reply will be, in tokens, from the prompt
  // alone: an explicit length request wins, otherwise the kind of request sets
  // a prior. Real replies then tune a per-model verbosity multiplier and a
  // per-kind average (see TL.learnReply).

  const WORDS = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
  const NUM = '(\\d{1,5}|a couple of|a few|one|two|three|four|five|six|seven|eight|nine|ten)';
  const toNum = (s) => {
    const k = s.toLowerCase().replace(/^a (couple|few) of$/, '$1');
    return /^\d/.test(k) ? Number(k) : WORDS[k] ?? 1;
  };

  // A number only sets the reply length when it reads like a request for one
  // ("in 100 words", "give me 5 ideas", "a 500-word essay"). Without that
  // context ("summarise these 5 paragraphs") it describes the input instead.
  // [plural pattern, singular pattern, tokens per unit]
  const UNITS = [
    ['words?', 'word', 1.35],
    ['sentences?', 'sentence', 28],
    ['paragraphs?', 'paragraph', 110],
    ['(?:bullets?|bullet points?|points?|items?|ideas?|examples?|tips?|steps?|reasons?|ways?|names?)', '(?:bullet|point|item|idea|example|tip|step|reason|way|name)', 35],
    ['lines?', 'line', 14],
  ];
  const LEAD =
    '(?:in|within|under|around|about|approx(?:imately)?|exactly|max(?:imum)?(?: of)?|at most|up to|less than|' +
    'no more than|only|just|using|with|give me|list|name|write|top|provide|generate|suggest)';
  const EXPLICIT = UNITS.flatMap(([plural, singular, per]) => [
    [new RegExp(`\\b${LEAD}\\s+${NUM}[\\s-]*${plural}\\b`, 'i'), per],
    [new RegExp(`\\b${NUM}-${singular}\\b`, 'i'), per],
  ]);
  EXPLICIT.push([/\b(\d{2,5}) words?\b/i, 1.35]);

  const KINDS = [
    { kind: 'greeting', label: 'chat', re: /^(?:hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|lol|yes|no)\b[\s!.?,]*$/i, tokens: () => 30 },
    { kind: 'rewrite', label: 'rewrite', re: /\b(?:rewrite|rephrase|proofread|paraphrase|translate|fix (?:the |my )?grammar|correct this|improve this|edit this)\b/i, tokens: (p) => Math.max(60, p * 1.1) },
    { kind: 'summary', label: 'summary', re: /\b(?:summari[sz]e|tl;?dr|key points|main points|recap)\b/i, tokens: (p) => Math.min(450, Math.max(120, p * 0.2)) },
    { kind: 'code', label: 'code', re: /```|\b(?:code|function|script|program|bug|error|regex|sql|python|javascript|typescript|html|css|api|class|component|implement|refactor|debug|compile)\b/i, tokens: () => 550 },
    { kind: 'write', label: 'writing', re: /\b(?:write|draft|compose|essay|story|poem|article|blog|email|letter|speech|cover letter)\b/i, tokens: () => 700 },
    { kind: 'list', label: 'list', re: /\b(?:list|ideas|brainstorm|options|examples|suggest|recommend|ways to|tips|names for|top \d+)\b/i, tokens: () => 380 },
    { kind: 'explain', label: 'explanation', re: /\b(?:explain|how (?:does|do|to|can)|why|compare|difference|pros and cons|walk me through|guide|tutorial|step[- ]by[- ]step|analy[sz]e|in detail)\b/i, tokens: () => 520 },
  ];

  const SHORT = /\b(?:brief(?:ly)?|concise(?:ly)?|short|quick(?:ly)?|tl;?dr|one-liner|in a nutshell)\b/i;
  const LONG = /\b(?:detailed|in detail|in[- ]depth|thorough(?:ly)?|comprehensive|long|exhaustive|deep dive)\b/i;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function classify(text, promptTokens) {
    for (const [re, per] of EXPLICIT) {
      const m = text.match(re);
      if (m) return { kind: 'explicit', label: 'requested length', prior: Math.max(3, toNum(m[1]) * per), exact: true };
    }
    let prior;
    let kind;
    let label;
    const hit = KINDS.find((k) => k.re.test(text));
    if (hit) {
      kind = hit.kind;
      label = hit.label;
      prior = hit.tokens(promptTokens);
    } else if (/\?\s*$/.test(text) || promptTokens > 6) {
      kind = 'question';
      label = 'question';
      prior = promptTokens <= 12 ? 140 : 260;
    } else {
      kind = 'chat';
      label = 'chat';
      prior = 90;
    }
    if (SHORT.test(text)) prior *= 0.5;
    else if (LONG.test(text)) prior *= 1.7;
    return { kind, label, prior: clamp(prior, 5, 6000), exact: false };
  }

  // learned shape: { "<model>": { mult, n }, "<model>:<kind>": { avg, n } }
  const entry = (learned, key) => {
    const v = learned?.[key];
    return v && typeof v === 'object' ? v : null;
  };

  TL.predictReply = (text, promptTokens, learned, modelId) => {
    const c = classify(text || '', promptTokens);
    if (c.exact) {
      return { kind: c.kind, label: c.label, prior: c.prior, tokens: Math.round(c.prior), low: Math.round(c.prior * 0.8), high: Math.round(c.prior * 1.25) };
    }
    const model = entry(learned, modelId);
    const kinds = entry(learned, `${modelId}:${c.kind}`);
    let tokens = c.prior * (model ? model.mult : 1);
    let spread = 2;
    if (kinds && kinds.n >= 2) {
      tokens = tokens * 0.3 + kinds.avg * 0.7;
      spread = 1.6;
    }
    tokens = clamp(tokens, 5, 8000);
    return {
      kind: c.kind,
      label: c.label,
      prior: c.prior,
      tokens: Math.round(tokens),
      low: Math.round(tokens / spread),
      high: Math.round(tokens * spread),
    };
  };

  // Folds one observed reply into `learned` (mutates and returns it).
  TL.learnReply = (learned, modelId, kind, prior, actual) => {
    const ratio = clamp(actual / prior, 0.2, 5);
    const m = entry(learned, modelId) ?? { mult: 1, n: 0 };
    const a = m.n === 0 ? 0.5 : 0.25;
    learned[modelId] = { mult: m.mult * (1 - a) + ratio * a, n: m.n + 1 };
    if (kind !== 'explicit') {
      const key = `${modelId}:${kind}`;
      const k = entry(learned, key) ?? { avg: actual, n: 0 };
      learned[key] = { avg: k.n === 0 ? actual : k.avg * 0.7 + actual * 0.3, n: k.n + 1 };
    }
    return learned;
  };
})();
