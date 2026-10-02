import { config } from './config.js';
import { store } from './store.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_MODEL = 'gemini-3.8-flash';

export function getAiSettings({ required = true } = {}) {
  const geminiKey = store.getApiKey('gemini');
  if (geminiKey) {
    return {
      key: geminiKey,
      baseUrl: GEMINI_BASE_URL,
      model: store.getGlobal('geminiModel', GEMINI_MODEL),
      source: 'WhatsApp Gemini key'
    };
  }

  const storedAiKey = store.getApiKey('ai');
  if (storedAiKey) {
    return {
      key: storedAiKey,
      baseUrl: store.getGlobal('aiBaseUrl', config.aiBaseUrl),
      model: store.getGlobal('aiModel', config.aiModel),
      source: 'WhatsApp AI key'
    };
  }

  if (config.aiKey) {
    return {
      key: config.aiKey,
      baseUrl: config.aiBaseUrl,
      model: config.aiModel,
      source: 'server environment'
    };
  }

  if (required) {
    throw new Error(
      'AI key missing. As the bot owner, send .addapikey gemini YOUR_GEMINI_KEY in a private chat.'
    );
  }

  return {
    key: '',
    baseUrl: '',
    model: '',
    source: 'not configured'
  };
}

export async function askAi(
  prompt,
  {
    system = '',
    temperature = 0.7,
    maxTokens = 1200,
    timeout = 45000
  } = {}
) {
  const { key, baseUrl, model } = getAiSettings();

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: String(prompt) });

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    }),
    signal: AbortSignal.timeout(timeout)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `AI provider returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || 'The AI provider returned no answer.';
}
