# Privacy policy

Tokenlens runs entirely in your browser. It has no server, no account, no analytics and no advertising.

## What it reads

On the supported chat sites (claude.ai, chatgpt.com, gemini.google.com, chat.deepseek.com, grok.com, perplexity.ai, chat.mistral.ai) it reads the text in the chat box and the messages shown on the page, only to count tokens and estimate cost. That text is processed in memory in your browser tab. It is never saved, logged or transmitted.

## What it stores

Stored locally with the browser's extension storage, on your device only:

- your settings (currency, daily budget, price overrides, pinned model per site)
- learned average reply lengths per model, as numbers
- estimated token totals per day for the last 31 days, as numbers
- the most recent exchange rates and the date they were fetched

No prompt or conversation text is stored. You can clear everything by removing the extension, or clear learned reply lengths from the popup.

## Network requests

The only request Tokenlens makes is to `api.frankfurter.dev`, an open exchange-rate service, to fetch currency rates about twice a day. The request contains no prompt text, no page content and no identifier. As with any web request, the service can see your IP address.

Tokenlens does not load or run remote code.

## Permissions

- `storage`: save the settings and numbers listed above.
- Access to the chat sites above: show the meter next to the chat box and read the text it measures.
- Access to `api.frankfurter.dev`: fetch exchange rates.

## Sharing

Tokenlens does not sell, share or transfer your data to anyone.

## Changes and contact

If this policy changes, the new version will be published in this repository. For questions, open an issue on the project's GitHub page.
