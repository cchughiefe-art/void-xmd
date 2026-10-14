'use strict';
const $ = id => document.getElementById(id);
let state = null, csrf = '', accountId = '', providerName = '', noticeTimer, loadingAccount = 0;
const titles = { overview: ['Your AI, under control.', 'Connected accounts, server usage, and AI availability.'], accounts: ['Make every account your own.', 'Personality, knowledge, automatic replies, and human control.'], providers: ['More options. Fewer interruptions.', 'Configure keys and models for your AI fallback chain.'] };
function notify(message, error = false) { clearTimeout(noticeTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; noticeTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
function showLogin() { state = null; csrf = ''; $('app').hidden = true; $('login').hidden = false; }
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) showLogin(); throw new Error(result.error || 'Request failed.'); }
  return result;
}
function buildRow(title, detail, badge, ready) { const row = document.createElement('div'); row.className = 'account-row'; const text = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = title; const small = document.createElement('small'); small.textContent = detail; text.append(strong, small); const pill = document.createElement('span'); pill.className = 'badge' + (ready ? ' ready' : ''); pill.textContent = badge; row.append(text, pill); return row; }
function renderOverview() {
  $('account-count').textContent = `${state.accounts.filter(x => x.connected).length} / ${state.maxAccounts}`;
  $('account-total').textContent = `${state.accounts.length} account${state.accounts.length === 1 ? '' : 's'} configured`;
  $('memory').textContent = `${state.memoryMB} MB`;
  $('provider-count').textContent = state.providers.filter(x => x.configured && !x.cooldownSeconds).length;
  $('account-list').replaceChildren();
  for (const account of state.accounts) $('account-list').append(buildRow(account.phone || 'Primary account', account.primary ? 'PRIMARY · main account' : 'LINKED · separate personality', account.status, account.connected));
  if (!state.accounts.length) { const text = document.createElement('p'); text.className = 'muted'; text.textContent = 'No accounts yet. Generate a pairing code to get started.'; $('account-list').append(text); }
  const previous = $('account-select').value;
  const ids = state.accounts.map(x => x.id).join(',');
  if ($('account-select').dataset.ids !== ids) {
    $('account-select').replaceChildren(...state.accounts.map(x => { const option = document.createElement('option'); option.value = x.id; option.textContent = `${x.phone || x.id}${x.primary ? ' · Primary' : ''}`; return option; }));
    $('account-select').dataset.ids = ids;
    if (state.accounts.some(x => x.id === previous)) $('account-select').value = previous;
  }
  $('pair-primary').checked = !state.accounts.some(x => x.primary && x.connected);
}
async function refresh() { state = await api('/api/state'); csrf = state.csrf; $('login').hidden = true; $('app').hidden = false; renderOverview(); return state; }
async function loadAccount() {
  const id = $('account-select').value; const request = ++loadingAccount;
  $('account-empty').hidden = Boolean(id); $('account-form').hidden = !id; $('chat-controls').hidden = !id;
  if (!id) { accountId = ''; return; }
  const data = await api(`/api/accounts/${encodeURIComponent(id)}`);
  if (request !== loadingAccount) return;
  accountId = id;
  for (const field of ['name', 'tone', 'personality', 'styleExamples', 'info', 'rules', 'location', 'hours']) $('account-form').elements[field].value = data.settings[field] || '';
  $('ai-enabled').checked = Boolean(data.settings.enabled); $('account-mode').value = data.mode;
  $('account-memory').textContent = `${data.memoryChats} conversations in memory · ${Object.keys(data.settings.pausedChats || {}).length} paused`;
  $('remove-account').hidden = id === 'primary';
}
function renderProviders() {
  if (!state.providers.some(x => x.name === providerName)) providerName = state.providers[0]?.name || '';
  $('provider-list').replaceChildren();
  for (const provider of state.providers) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'provider-choice' + (provider.name === providerName ? ' selected' : '');
    const label = document.createElement('span'); label.textContent = provider.name.charAt(0).toUpperCase() + provider.name.slice(1);
    const detail = document.createElement('small'); detail.textContent = provider.experimental ? 'Trial / experimental' : 'Free allowance'; label.append(detail);
    const status = document.createElement('span'); status.className = 'badge' + (provider.configured ? ' ready' : ''); status.textContent = provider.cooldownSeconds ? 'Cooling down' : provider.configured ? 'Ready' : 'Setup';
    button.append(label, status); button.addEventListener('click', () => { providerName = provider.name; renderProviders(); }); $('provider-list').append(button);
  }
  const p = state.providers.find(x => x.name === providerName); if (!p) return;
  $('provider-title').textContent = p.name.charAt(0).toUpperCase() + p.name.slice(1);
  $('provider-allowance').textContent = p.allowance;
  $('provider-warning').hidden = !p.experimental;
  $('provider-warning').textContent = 'Optional trial adapter. Check its terms first. Experimental providers require AI_EXPERIMENTAL_PROVIDERS on the server; saving a key here does not enable that flag.';
  $('provider-model').value = p.model || ''; $('provider-key').value = ''; $('provider-enabled').checked = p.enabled;
  $('provider-key-status').textContent = p.hasSavedKey ? 'A saved key exists. Its value is hidden.' : p.configured ? 'Configured through the server environment.' : 'Not ready yet. Add a key and any required settings.';
  $('cloudflare-fields').hidden = p.name !== 'cloudflare'; $('cloudflare-account').value = state.cloudflareAccountId || '';
}
async function openTab(name) {
  for (const key of Object.keys(titles)) $(key).hidden = key !== name;
  document.querySelectorAll('[data-tab]').forEach(button => { const active = button.dataset.tab === name; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
  [$('page-title').textContent, $('page-description').textContent] = titles[name];
  if (name === 'accounts') await loadAccount(); if (name === 'providers') renderProviders();
}
function task(handler) { return async event => { event?.preventDefault(); const button = event?.submitter || event?.currentTarget; if (button?.tagName === 'BUTTON') button.disabled = true; try { await handler(event); } catch (error) { notify(error.message, true); } finally { if (button?.tagName === 'BUTTON') button.disabled = false; } }; }
$('login-form').addEventListener('submit', task(async () => { const key = $('admin-key').value; try { const result = await api('/api/login', { key }); csrf = result.csrf; await refresh(); await openTab('overview'); } finally { $('admin-key').value = ''; } }));
$('logout').addEventListener('click', task(async () => { await api('/api/logout', {}); showLogin(); }));
$('refresh').addEventListener('click', task(async () => { await refresh(); notify('Status updated.'); }));
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', task(() => openTab(button.dataset.tab))));
$('manage-accounts').addEventListener('click', task(() => openTab('accounts')));
$('account-select').addEventListener('change', task(loadAccount));
$('pair-form').addEventListener('submit', task(async () => { notify('Generating a pairing code. This can take a moment.'); const result = await api('/api/pair', { phone: $('pair-phone').value, primary: $('pair-primary').checked }); $('pair-result').hidden = false; $('pair-code').textContent = result.code; await refresh(); notify('Enter this code in WhatsApp Linked devices.'); }));
$('account-form').addEventListener('submit', task(async () => { if (!accountId) throw new Error('Choose an account first.'); const data = Object.fromEntries(new FormData($('account-form'))); data.enabled = $('ai-enabled').checked; await api(`/api/accounts/${encodeURIComponent(accountId)}/settings`, data); notify('Account settings saved.'); await refresh(); }));
for (const action of ['pause', 'resume']) $(action + '-chat').addEventListener('click', task(async () => { if (!accountId) throw new Error('Choose an account first.'); await api(`/api/accounts/${encodeURIComponent(accountId)}/${action}`, { phone: $('customer-phone').value }); notify(action === 'pause' ? 'AI replies paused for this contact.' : 'AI replies resumed for this contact.'); await loadAccount(); }));
$('clear-memory').addEventListener('click', task(async () => { if (!accountId || !confirm('Clear AI conversation memory for this account?')) return; await api(`/api/accounts/${encodeURIComponent(accountId)}/clear-memory`, { confirm: true }); notify('Conversation memory cleared.'); await loadAccount(); }));
$('remove-account').addEventListener('click', task(async () => { if (!accountId || !confirm('Disconnect this WhatsApp account and remove its saved session? You will need to pair it again.')) return; await api(`/api/accounts/${encodeURIComponent(accountId)}/remove`, { confirm: true }); await refresh(); await loadAccount(); notify('Account disconnected.'); }));
$('provider-form').addEventListener('submit', task(async () => { const key = $('provider-key').value.trim(); const data = { model: $('provider-model').value.trim(), enabled: $('provider-enabled').checked, ...(key ? { key } : {}), ...(providerName === 'cloudflare' ? { accountId: $('cloudflare-account').value.trim() } : {}) }; await api(`/api/providers/${providerName}`, data); $('provider-key').value = ''; await refresh(); renderProviders(); notify('Provider settings saved.'); }));
$('remove-key').addEventListener('click', task(async () => { if (!confirm('Remove this provider’s saved API key? Environment keys are managed separately on the server.')) return; await api(`/api/providers/${providerName}`, { removeKey: true }); await refresh(); renderProviders(); notify('Saved key removed.'); }));
refresh().catch(() => showLogin());
setInterval(() => { if (state && document.visibilityState === 'visible') refresh().catch(error => { if (state) notify(error.message, true); }); }, 20000);
