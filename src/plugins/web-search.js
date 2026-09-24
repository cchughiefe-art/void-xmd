const clean = value => value
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

async function brave(query, key) {
  const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: '6', country: 'NG', search_lang: 'en' })}`;
  const response = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': key }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Brave Search returned ${response.status}`);
  const data = await response.json();
  return (data.web?.results || []).map(item => ({ title: item.title, url: item.url, description: item.description }));
}

async function duckDuckGo(query) {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; VOID-XMD/1.0)' }, signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Search fallback returned ${response.status}`);
  const html = await response.text(), results = [];
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    let url = clean(match[1]);
    try { const redirect = new URL(url, 'https://duckduckgo.com'); url = redirect.searchParams.get('uddg') || redirect.href; } catch {}
    results.push({ title: clean(match[2]), url: decodeURIComponent(url), description: clean(match[3]) });
    if (results.length === 6) break;
  }
  return results;
}

export default {
  name: 'websearch', aliases: ['search','google'], category: 'WEB SEARCH', description: 'Search the web',
  async run({ text, reply, config }) {
    if (!text) throw new Error('Usage: .websearch latest technology news');
    let results = [];
    if (config.braveSearchKey) results = await brave(text, config.braveSearchKey).catch(() => []);
    if (!results.length) results = await duckDuckGo(text);
    if (!results.length) throw new Error('No web results found. Try a more specific search.');
    const output = results.map((item,index)=>`*${index+1}. ${item.title}*\n${item.description || 'No description'}\n${item.url}`).join('\n\n');
    await reply(`🔎 *Web results for:* ${text}\n\n${output}`);
  }
};
