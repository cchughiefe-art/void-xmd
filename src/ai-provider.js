import { config } from './config.js';
import { store } from './store.js';

// Experimental/trial services are opt-in and are never described as unlimited.
export const providerCatalog = Object.freeze([
  { name: 'gemini', env: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', allowance: 'Free-tier model; project/model quotas apply' },
  { name: 'groq', env: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b', allowance: 'Free plan; model-specific request/token limits' },
  { name: 'openrouter', env: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', allowance: '50 requests/day, 20/minute on an unfunded account' },
  { name: 'cloudflare', env: 'CLOUDFLARE_API_TOKEN', baseUrl: '', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', allowance: '10,000 neurons/day on Workers Free; account ID required' },
  { name: 'huggingface', env: 'HF_TOKEN', baseUrl: 'https://router.huggingface.co/v1', model: '', allowance: '$0.10 monthly credits, subject to change; select an available model' },
  { name: 'mistral', env: 'MISTRAL_API_KEY', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', experimental: true, allowance: 'Free mode for experimentation; account limits apply' },
  { name: 'nvidia', env: 'NVIDIA_API_KEY', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct', experimental: true, allowance: 'Developer preview/prototyping; entitlement limits apply' },
  { name: 'cohere', env: 'COHERE_API_KEY', baseUrl: 'https://api.cohere.ai/compatibility/v1', model: 'command-a-03-2025', experimental: true, allowance: 'Trial: 1,000 calls/month; not for production/commercial use' },
  { name: 'cerebras', env: 'CEREBRAS_API_KEY', baseUrl: 'https://api.cerebras.ai/v1', model: 'qwen-3.8-27b', experimental: true, allowance: 'Check current account; promo credits can require a payment method and expire' }
]);
const cooldowns = new Map();
const allowedTrials = () => new Set(String(process.env.AI_EXPERIMENTAL_PROVIDERS || '').split(',').map(x => x.trim()));

export function getAiProviders() {
  const order = String(process.env.AI_PROVIDER_ORDER || providerCatalog.map(x => x.name).join(',')).split(',').map(x => x.trim());
  const providers = [];
  for (const name of [...new Set(order)]) {
    const item = providerCatalog.find(x => x.name === name);
    if (!item || (item.experimental && !allowedTrials().has(name))) continue;
    if (store.getGlobal(`${name}Enabled`, true) === false) continue;
    const saved = store.getApiKey(name);
    const key = saved || process.env[item.env] || '';
    if (!key) continue;
    let baseUrl = item.baseUrl;
    if (name === 'cloudflare') {
      const account = process.env.CLOUDFLARE_ACCOUNT_ID || store.getGlobal('cloudflareAccountId', '');
      if (!/^[a-zA-Z0-9]+$/.test(account)) continue;
      baseUrl = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`;
    }
    const model = store.getGlobal(`${name}Model`, process.env[`${name.toUpperCase()}_MODEL`] || item.model);
    if (!model) continue;
    if (name === 'openrouter' && model !== 'openrouter/free' && !model.endsWith(':free')) continue;
    providers.push({ ...item, key, baseUrl, model, source: saved ? 'saved key' : item.env });
  }
  // Preserve existing custom provider setup in the full bot; opt-in in chat-only mode.
  if (!config.chatOnly || process.env.AI_ALLOW_CUSTOM === 'true') {
    const key = store.getApiKey('ai') || config.aiKey;
    if (key) providers.push({ name: 'custom', key, baseUrl: store.getGlobal('aiBaseUrl', config.aiBaseUrl), model: store.getGlobal('aiModel', config.aiModel), source: 'custom configuration' });
  }
  return providers;
}
export function getAiSettings({ required = true } = {}) {
  const provider = getAiProviders()[0];
  if (provider) return provider;
  if (required) throw new Error('No AI provider configured. Configure a supported provider key on the server.');
  return { name: '', key: '', baseUrl: '', model: '', source: 'not configured' };
}
export function aiProviderStatus() {
  const providers = getAiProviders();
  return providerCatalog.map(item => {
    const p = providers.find(x => x.name === item.name);
    return { name: item.name, configured: Boolean(p), model: p?.model || item.model, experimental: Boolean(item.experimental), allowance: item.allowance, cooldownSeconds: Math.max(0, Math.ceil(((cooldowns.get(item.name) || 0) - Date.now()) / 1000)) };
  });
}

async function callProvider(provider, messages, { temperature, maxTokens, timeout }) {
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.key}` },
    body: JSON.stringify({ model: provider.model, messages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const seconds = Number(retry);
    const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : (Date.parse(retry) - Date.now());
    const error = new Error(`${provider.name} HTTP ${response.status}`);
    error.cooldown = [401, 403].includes(response.status) ? 600000 : response.status === 429 ? Math.min(86400000, Math.max(60000, delay || 0)) : 30000;
    await response.body?.cancel().catch(() => {});
    throw error;
  }
  const data = await response.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const answer = (typeof content === 'string' ? content : Array.isArray(content) ? content.map(x => x.text || '').join('') : '').trim();
  if (!answer || choice.finish_reason === 'length') throw new Error(`${provider.name} returned an empty or incomplete reply`);
  return answer;
}
let active = 0;
const waiters = [];
async function acquire() {
  if (active < 2) { active++; return; }
  if (waiters.length >= 16) throw new Error('AI is busy. Please try again shortly.');
  await new Promise(resolve => waiters.push(resolve));
}
function release() { const next = waiters.shift(); if (next) next(); else active--; }
export async function askAi(prompt, { system = '', temperature = 0.7, maxTokens = 1200, timeout = 45000 } = {}) {
  const providers = getAiProviders();
  if (!providers.length) getAiSettings();
  await acquire();
  try {
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: String(prompt) }];
    const deadline = Date.now() + Math.min(60000, Math.max(1000, timeout));
    for (const provider of providers) {
      if ((cooldowns.get(provider.name) || 0) > Date.now()) continue;
      const remaining = deadline - Date.now();
      if (remaining < 100) break;
      try {
        return await callProvider(provider, messages, { temperature, maxTokens, timeout: Math.min(12000, remaining) });
      } catch (error) {
        cooldowns.set(provider.name, Date.now() + (error.cooldown || 15000));
        // Never log response bodies, credentials, or user prompts.
        console.warn(`AI provider unavailable: ${provider.name}`);
      }
    }
    throw new Error('Configured AI providers are temporarily unavailable or at their limits.');
  } finally { release(); }
}
