(() => {
  const TL = (globalThis.TL ??= {});

  // The trimmer only removes words that carry no instruction. Everything
  // here was chosen so that it cannot change what you are asking:
  //   - code blocks, inline code, URLs and quoted strings are never touched
  //   - indentation, line breaks and repeated lines are left alone
  //   - "can you ..." is only dropped before a plain request verb
  const PROTECTED = /(```[\s\S]*?```|`[^`\n]+`|https?:\/\/\S+|"[^"\n]{1,200}")/g;

  const MARK = '\u0001'; // "capitalise whatever comes next"
  const START = `(?<=^|${MARK}|[.!?:]\\s+|\\n)`;

  const at = (pattern) => new RegExp(START + pattern, 'gi');
  const anywhere = (pattern) => new RegExp(pattern, 'gi');

  const REQUEST_VERBS =
    'help|write|explain|give|make|create|show|tell|summari[sz]e|list|find|fix|check|review|generate|draft|' +
    'provide|translate|rewrite|describe|add|remove|convert|build|compare|suggest|recommend|walk|break|' +
    'calculate|solve|analy[sz]e|improve|simplify|come up|put|send|outline|rephrase|proofread|clean|format|sort';

  // [pattern, replacement]. Order matters: greetings go first so the polite
  // openers behind them are still recognised as sentence starts.
  const RULES = [
    [at("(?:hi|hey|hello)(?: there)?(?: (?:claude|chatgpt|gemini|deepseek|grok))?[,!.]?\\s+"), ''],
    [at(`(?:could|can|would|will) you (?:please |kindly )?(?=(?:${REQUEST_VERBS})\\b)`), ''],
    [at("i(?:'d| would) (?:like|love) (?:you )?to (?=(?:" + REQUEST_VERBS + ")\\b)"), ''],
    [at(`i (?:want|need) you to (?=(?:${REQUEST_VERBS})\\b)`), ''],
    [at('please,?\\s+'), ''],
    [anywhere(',?\\s+please(?=\\s*[.!?]|\\s*$)'), ''],
    [anywhere('\\b(?:basically|honestly|obviously)\\b,?\\s*'), ''],
    [anywhere('\\bi mean,\\s*'), ''],
    [anywhere("\\bit(?: is|'s) (?:important|worth) (?:to note|noting) that\\b,?\\s*"), ''],
    [anywhere('\\bneedless to say\\b,?\\s*'), ''],
    [anywhere('\\bin order to\\b'), 'to'],
    [anywhere('\\bdue to the fact that\\b'), 'because'],
    [anywhere('\\bat this point in time\\b'), 'now'],
    [anywhere('\\bin the event that\\b'), 'if'],
  ];

  const TAIL = [
    /(?:\s*(?:thanks|thank you)(?: so much| very much| a lot)?(?: in advance)?[.!]*)+\s*$/i,
    /\s*(?:i hope (?:this|that) makes sense|let me know if you (?:have|need) (?:any )?(?:questions|more (?:info|information|context)))[.!]*\s*$/i,
  ];

  const startsSentence = (whole, offset, first) => {
    if (offset === 0) return first;
    return /(?:[.!?:]\s+|\n|\u0001)$/.test(whole.slice(Math.max(0, offset - 6), offset));
  };

  function cleanPart(part, first) {
    let s = part;
    for (const [re, rep] of RULES) {
      s = s.replace(re, (m, ...rest) => {
        const offset = rest[rest.length - 2];
        const whole = rest[rest.length - 1];
        return (startsSentence(whole, offset, first) ? MARK : '') + rep;
      });
    }
    s = s
      .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ') // mid-line only: indentation is kept
      .replace(/([!?])\1+/g, '$1')
      .replace(/\.{4,}/g, '...')
      .replace(/\n{3,}/g, '\n\n');
    if (first) s = s.replace(/^[\s,;:]+/, '');
    return s
      .replace(/\u0001+(\s*)(\p{Ll})/gu, (_, sp, ch) => sp + ch.toUpperCase())
      .replace(/\u0001+/g, '');
  }

  TL.trim = (input) => {
    const parts = input.split(PROTECTED);
    let text = parts.map((part, i) => (i % 2 ? part : cleanPart(part, i === 0))).join('');
    for (const re of TAIL) text = text.replace(re, '');
    text = text.trim();
    return { text, changed: text !== input.trim() };
  };
})();
