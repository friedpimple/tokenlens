(() => {
  const TL = (globalThis.TL ??= {});

  // Providers use different tokenizers and none ship one we can run in a page,
  // so this is a structural estimate, not an exact count. For English prose it
  // lands within roughly 15% of the common BPE tokenizers.
  const TOKEN_RE = new RegExp(
    [
      '(?<cjk>[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af]+)',
      "(?<word>[\\p{L}\\p{M}]+(?:['\\u2019][\\p{L}]+)?)",
      '(?<num>\\p{N}+)',
      '(?<nl>\\n+)',
      '(?<emo>\\p{Extended_Pictographic}\\uFE0F?)',
      '(?<sym>\\S)',
    ].join('|'),
    'gu',
  );

  const wordCost = (w) => (w.length <= 6 ? 1 : Math.ceil(w.length / 4.5));

  TL.countTokens = (text) => {
    if (!text) return 0;
    let n = 0;
    for (const m of text.matchAll(TOKEN_RE)) {
      const g = m.groups;
      const s = m[0];
      if (g.cjk) n += [...s].length;
      else if (g.word) {
        const [base, tail] = s.split(/['’]/);
        n += wordCost(base) + (tail ? 1 : 0);
      } else if (g.num) n += Math.ceil(s.length / 3);
      else if (g.emo) n += 2;
      else n += 1; // newline run or a single symbol
    }
    return n;
  };
})();
