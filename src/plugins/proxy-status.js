import { fetchViaProxy, networkFallbackStatus } from '../network.js';

function short(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

async function routeProbe(proxy) {
  const started = Date.now();
  try {
    const response = await fetchViaProxy(
      'https://api.ipify.org?format=json',
      { method: 'GET', signal: AbortSignal.timeout(20000) },
      proxy
    );
    const text = await response.text();
    return {
      ok: response.ok,
      ms: Date.now() - started,
      detail: response.ok ? short(text) : `HTTP ${response.status}: ${short(text)}`
    };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      detail: short(error?.message || error)
    };
  }
}

export default [
  {
    name: 'proxystatus',
    aliases: ['netfallback','proxyinfo'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Show configured outbound proxy fallbacks without exposing credentials',

    async run({ reply }) {
      const status = networkFallbackStatus();
      await reply(
        `*Outbound fallback*\n` +
        `Enabled: ${status.enabled ? 'YES' : 'NO'}\n` +
        `Order: direct → SOCKS5 → HTTP\n` +
        `Safe automatic retries: ${status.safeMethods.join(', ')}\n` +
        `Retry statuses: ${status.retryStatuses.join(', ')}\n` +
        `Configured proxies: ${status.proxies.length}\n` +
        status.proxies.map((x, i) => `${i + 1}. ${x}`).join('\n') +
        `\n\nyt-dlp/download commands also use the same direct → SOCKS5 → HTTP fallback.`
      );
    }
  },
  {
    name: 'proxytest',
    aliases: ['nettest'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Test each configured proxy route and show the outbound IP',

    async run({ reply }) {
      const status = networkFallbackStatus();
      if (!status.proxies.length) throw new Error('No outbound proxies are configured.');

      const rows = [];
      for (let i = 0; i < status.proxies.length; i++) {
        const raw =
          i === 0
            ? String(process.env.OUTBOUND_PROXY_SOCKS5 || '').trim()
            : String(process.env.OUTBOUND_PROXY_HTTP || '').trim();

        if (!raw) continue;
        const result = await routeProbe(raw);
        rows.push(
          `${result.ok ? 'PASS' : 'FAIL'} ${status.proxies[i]} (${result.ms}ms)\n${result.detail}`
        );
      }

      await reply(`*Proxy route test*\n${rows.join('\n\n')}`);
    }
  }
];
