import { config } from './config.js';
import { store } from './store.js';

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

const GEMINI_MODEL = 'gemini-3.8-flash';

const GROQ_BASE_URL =
  'https://api.groq.com/openai/v1';

const GROQ_MODEL =
  process.env.GROQ_MODEL || 'openai/gpt-oss-20b';


export function getAiProviders() {
  const providers = [];

  const geminiKey = store.getApiKey('gemini');

  if (geminiKey) {
    providers.push({
      name: 'gemini',
      key: geminiKey,
      baseUrl: GEMINI_BASE_URL,
      model: store.getGlobal(
        'geminiModel',
        GEMINI_MODEL
      ),
      source: 'WhatsApp Gemini key'
    });
  }


  const savedGroqKey =
    store.getApiKey('groq');

  const groqKey =
    savedGroqKey ||
    process.env.GROQ_API_KEY ||
    '';

  if (groqKey) {
    providers.push({
      name: 'groq',
      key: groqKey,
      baseUrl: GROQ_BASE_URL,
      model: store.getGlobal(
        'groqModel',
        GROQ_MODEL
      ),
      source: savedGroqKey
        ? 'WhatsApp Groq key'
        : 'GROQ_API_KEY environment'
    });
  }


  const storedAiKey =
    store.getApiKey('ai');

  if (storedAiKey) {
    providers.push({
      name: 'custom',
      key: storedAiKey,
      baseUrl: store.getGlobal(
        'aiBaseUrl',
        config.aiBaseUrl
      ),
      model: store.getGlobal(
        'aiModel',
        config.aiModel
      ),
      source: 'WhatsApp AI key'
    });
  }


  if (config.aiKey) {
    providers.push({
      name: 'environment',
      key: config.aiKey,
      baseUrl: config.aiBaseUrl,
      model: config.aiModel,
      source: 'server environment'
    });
  }


  return providers;
}


export function getAiSettings({
  required = true
} = {}) {

  const provider =
    getAiProviders()[0];

  if (provider) {
    return provider;
  }


  if (required) {
    throw new Error(
      'AI key missing. Use .addapikey gemini KEY or .addapikey groq KEY in a private chat.'
    );
  }


  return {
    name: '',
    key: '',
    baseUrl: '',
    model: '',
    source: 'not configured'
  };
}


async function callProvider(
  provider,
  messages,
  {
    temperature,
    maxTokens,
    timeout
  }
) {

  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',

      headers: {
        'content-type':
          'application/json',

        authorization:
          `Bearer ${provider.key}`
      },

      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature,
        max_tokens: maxTokens
      }),

      signal:
        AbortSignal.timeout(timeout)
    }
  );


  if (!response.ok) {

    const body =
      await response.text()
        .catch(() => '');

    throw new Error(
      `${provider.name} HTTP ${response.status}` +
      `${body ? `: ${body.slice(0, 200)}` : ''}`
    );
  }


  const data =
    await response.json();

  const choice =
    data.choices?.[0];

  const answer =
    choice?.message?.content?.trim() || '';

  const finishReason =
    choice?.finish_reason || '';


  if (!answer) {
    throw new Error(
      `${provider.name} returned an empty reply`
    );
  }


  /*
   * Important:
   * don't send visibly chopped replies.
   *
   * If Gemini/Groq says the completion
   * stopped because of the token limit,
   * throw so the next provider retries.
   */
  if (finishReason === 'length') {
    throw new Error(
      `${provider.name} reply was incomplete`
    );
  }


  return answer;
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

  const providers =
    getAiProviders();


  if (!providers.length) {
    getAiSettings();
  }


  const messages = [];

  if (system) {
    messages.push({
      role: 'system',
      content: system
    });
  }


  messages.push({
    role: 'user',
    content: String(prompt)
  });


  const failures = [];


  for (
    let i = 0;
    i < providers.length;
    i++
  ) {

    const provider =
      providers[i];


    try {

      const answer =
        await callProvider(
          provider,
          messages,
          {
            temperature,
            maxTokens,
            timeout
          }
        );


      if (i > 0) {
        console.warn(
          `AI fallback used: ${provider.name}/${provider.model}`
        );
      }


      return answer;


    } catch (error) {

      console.error(
        `AI provider failed (${provider.name}/${provider.model}):`,
        error.message
      );


      failures.push(
        `${provider.name}: ${error.message}`
      );
    }
  }


  throw new Error(
    `All AI providers failed: ${failures.join(' | ')}`
  );
}
