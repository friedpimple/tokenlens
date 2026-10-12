(() => {
  const TL = (globalThis.TL ??= {});

  // Everything site-specific lives here. Chat UIs change their markup without
  // notice; when a selector stops matching, this is the only file to patch.
  //
  //   input     where the user types (first selector with a visible match wins)
  //   messages  elements holding conversation text, used to measure the context
  //             that gets re-sent with every message
  //   send      send buttons, used to notice when a message goes out
  //   model     optional elements whose text names the active model
  const GENERIC_INPUT = [
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
  ];

  TL.SITES = [
    {
      vendor: 'claude',
      host: /(^|\.)claude\.ai$/,
      input: ['div[contenteditable="true"].ProseMirror', 'fieldset div[contenteditable="true"]', ...GENERIC_INPUT],
      messages: ['[data-testid="user-message"]', '.font-claude-response', '.font-claude-message'],
      send: ['button[aria-label*="Send" i]'],
      model: ['[data-testid="model-selector-dropdown"]'],
    },
    {
      vendor: 'openai',
      host: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
      input: ['#prompt-textarea', 'textarea[name="prompt-textarea"]', ...GENERIC_INPUT],
      messages: ['[data-message-author-role]'],
      send: ['[data-testid="send-button"]', 'button[aria-label*="Send" i]'],
      model: ['[data-testid="model-switcher-dropdown-button"]'],
    },
    {
      vendor: 'gemini',
      host: /(^|\.)gemini\.google\.com$/,
      input: ['rich-textarea .ql-editor', 'div.ql-editor[contenteditable="true"]', ...GENERIC_INPUT],
      messages: ['user-query', 'model-response'],
      send: ['button.send-button', 'button[aria-label*="Send" i]'],
      model: [],
    },
    {
      vendor: 'deepseek',
      host: /(^|\.)deepseek\.com$/,
      input: ['textarea#chat-input', ...GENERIC_INPUT],
      messages: ['.ds-markdown', '.ds-message'],
      send: ['[role="button"][aria-disabled="false"]'],
      model: [],
    },
    {
      vendor: 'grok',
      host: /(^|\.)grok\.com$/,
      input: GENERIC_INPUT,
      messages: ['.message-bubble'],
      send: ['button[type="submit"]', 'button[aria-label*="Submit" i]'],
      model: [],
    },
    {
      vendor: 'perplexity',
      host: /(^|\.)perplexity\.ai$/,
      input: ['#ask-input', ...GENERIC_INPUT],
      messages: ['[id^="markdown-content"]'],
      send: ['button[aria-label*="Submit" i]', 'button[type="submit"]'],
      model: [],
    },
    {
      vendor: 'mistral',
      host: /(^|\.)mistral\.ai$/,
      input: GENERIC_INPUT,
      messages: ['[data-message-author-role]'],
      send: ['button[type="submit"]', 'button[aria-label*="Send" i]'],
      model: [],
    },
  ];
})();
