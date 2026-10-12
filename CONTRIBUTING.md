# Contributing to Tokenlens

Thanks for helping out. The project is small on purpose: plain JavaScript, no build step, no dependencies.

## The most useful contribution: fixing selectors

Chat sites change their markup often. If the meter vanishes or the conversation count shows "unavailable" on a site:

1. Open the site's dev tools and find the chat input, the message elements, the send button and (optionally) the model label.
2. Update the matching entry in `src/sites.js`.
3. Say which site and roughly when you checked in the pull request.

## Other ways to help

- Correct or add model prices and context sizes in `src/data.js`
- Add a new site to `src/sites.js` (and its host to `manifest.json` under `content_scripts.matches`)
- Add rules to `src/trim.js`. A good rule never changes meaning, never touches code, and has a test.

## Ground rules

- No `innerHTML` in page-facing code. Several supported sites enforce Trusted Types, so build UI with DOM APIs.
- No network calls other than the exchange-rate fetch, and never send prompt or conversation text anywhere.
- Keep the UI quiet: neutral colours, no animation for its own sake.

## Before opening a pull request

```
node scripts/test.js
```

Add a test for any change to `src/estimate.js` or `src/trim.js`. Test in both Chrome and Firefox if you can, and mention which you used.

## Reporting bugs

Include the browser and version, the site, what you expected, and what happened. Please don't paste private conversation text.

By contributing you agree your work is released under the MIT licence in `LICENSE`.
