import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Readable } from 'node:stream';

const nativeFetch = globalThis.fetch.bind(globalThis);

const SAFE_METHODS = new Set(['GET', 'HEAD']);
const DEFAULT_RETRY_STATUSES = new Set([
  403, 408, 425, 429, 451,
  500, 502, 503, 504,
  520, 521, 522, 523, 524
]);

function enabled() {
  return !/^(?:0|false|off|no)$/i.test(String(process.env.OUTBOUND_PROXY_FALLBACK || '1'));
}

function proxyUrls() {
  if (!enabled()) return [];
  return [
    String(process.env.OUTBOUND_PROXY_SOCKS5 || '').trim(),
    String(process.env.OUTBOUND_PROXY_HTTP || '').trim()
  ].filter(Boolean);
}

function retryStatuses() {
  const raw = String(process.env.OUTBOUND_PROXY_RETRY_STATUSES || '').trim();
  if (!raw) return DEFAULT_RETRY_STATUSES;
  return new Set(
    raw.split(',')
      .map(x => Number(x.trim()))
      .filter(Number.isInteger)
  );
}

function redactProxy(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '<invalid proxy>';
  }
}

function normalizeHeaders(input) {
  const headers = new Headers(input || {});
  const out = {};
  for (const [key, value] of headers.entries()) out[key] = value;
  return out;
}

function basicProxyAuth(proxy) {
  if (!proxy.username && !proxy.password) return '';
  const raw = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

function waitForConnect(socket, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('secureConnect', onConnect);
      socket.off('error', onError);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error('Proxy connection timed out'));
    }, timeoutMs);
    timer.unref?.();
    socket.once(socket.encrypted ? 'secureConnect' : 'connect', onConnect);
    socket.once('error', onError);
  });
}

function readSome(socket, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
    };
    const onData = data => {
      cleanup();
      resolve(Buffer.from(data));
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('Proxy socket ended unexpectedly'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Proxy read timed out'));
    }, timeoutMs);
    timer.unref?.();
    socket.once('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
  });
}

async function readExact(socket, count, timeoutMs = 15000) {
  let out = Buffer.alloc(0);
  while (out.length < count) {
    const chunk = await readSome(socket, timeoutMs);
    out = Buffer.concat([out, chunk]);
  }
  if (out.length > count) socket.unshift(out.subarray(count));
  return out.subarray(0, count);
}

async function connectSocks5(proxy, target, timeoutMs = 15000) {
  const port = Number(proxy.port || 1080);
  const socket = net.connect({ host: proxy.hostname, port });
  await waitForConnect(socket, timeoutMs);

  const hasAuth = Boolean(proxy.username || proxy.password);
  socket.write(Buffer.from(hasAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));

  const greeting = await readExact(socket, 2, timeoutMs);
  if (greeting[0] !== 0x05 || greeting[1] === 0xff) {
    socket.destroy();
    throw new Error('SOCKS5 proxy rejected authentication methods');
  }

  if (greeting[1] === 0x02) {
    const user = Buffer.from(decodeURIComponent(proxy.username || ''));
    const pass = Buffer.from(decodeURIComponent(proxy.password || ''));
    if (user.length > 255 || pass.length > 255) {
      socket.destroy();
      throw new Error('SOCKS5 proxy credentials are too long');
    }

    socket.write(Buffer.concat([
      Buffer.from([0x01, user.length]),
      user,
      Buffer.from([pass.length]),
      pass
    ]));

    const authReply = await readExact(socket, 2, timeoutMs);
    if (authReply[1] !== 0x00) {
      socket.destroy();
      throw new Error('SOCKS5 proxy authentication failed');
    }
  } else if (greeting[1] !== 0x00) {
    socket.destroy();
    throw new Error(`Unsupported SOCKS5 auth method ${greeting[1]}`);
  }

  const host = Buffer.from(target.hostname);
  if (host.length > 255) {
    socket.destroy();
    throw new Error('Target hostname is too long for SOCKS5');
  }

  const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const request = Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
    host,
    Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
  ]);

  socket.write(request);

  const head = await readExact(socket, 4, timeoutMs);
  if (head[0] !== 0x05 || head[1] !== 0x00) {
    socket.destroy();
    throw new Error(`SOCKS5 CONNECT failed (${head[1]})`);
  }

  if (head[3] === 0x01) await readExact(socket, 4 + 2, timeoutMs);
  else if (head[3] === 0x04) await readExact(socket, 16 + 2, timeoutMs);
  else if (head[3] === 0x03) {
    const len = (await readExact(socket, 1, timeoutMs))[0];
    await readExact(socket, len + 2, timeoutMs);
  } else {
    socket.destroy();
    throw new Error('SOCKS5 proxy returned an unknown address type');
  }

  return socket;
}

async function connectHttpTunnel(proxy, target, timeoutMs = 15000) {
  const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
  const socket = proxy.protocol === 'https:'
    ? tls.connect({ host: proxy.hostname, port: proxyPort, servername: proxy.hostname })
    : net.connect({ host: proxy.hostname, port: proxyPort });

  await waitForConnect(socket, timeoutMs);

  const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const auth = basicProxyAuth(proxy);
  const lines = [
    `CONNECT ${target.hostname}:${targetPort} HTTP/1.1`,
    `Host: ${target.hostname}:${targetPort}`,
    'Proxy-Connection: Keep-Alive'
  ];
  if (auth) lines.push(`Proxy-Authorization: ${auth}`);
  lines.push('', '');

  socket.write(lines.join('\r\n'));

  let buffered = Buffer.alloc(0);
  while (!buffered.includes(Buffer.from('\r\n\r\n'))) {
    buffered = Buffer.concat([buffered, await readSome(socket, timeoutMs)]);
    if (buffered.length > 64 * 1024) {
      socket.destroy();
      throw new Error('HTTP proxy CONNECT response was too large');
    }
  }

  const marker = buffered.indexOf(Buffer.from('\r\n\r\n'));
  const header = buffered.subarray(0, marker).toString('latin1');
  const rest = buffered.subarray(marker + 4);
  const statusLine = header.split('\r\n')[0] || '';
  const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/i);

  if (!match || Number(match[1]) !== 200) {
    socket.destroy();
    throw new Error(`HTTP proxy CONNECT failed: ${statusLine || 'unknown response'}`);
  }

  if (rest.length) socket.unshift(rest);
  return socket;
}

function requestWithSocket(target, init, connectedSocket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const headers = normalizeHeaders(init.headers);
    if (!headers.host) headers.host = target.host;
    if (!headers['user-agent']) headers['user-agent'] = 'VOID-XMD/1.0';

    const common = {
      method: String(init.method || 'GET').toUpperCase(),
      hostname: target.hostname,
      port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)),
      path: `${target.pathname}${target.search}`,
      headers,
      agent: false,
      signal: init.signal
    };

    let req;
    if (target.protocol === 'https:') {
      req = https.request({
        ...common,
        createConnection: () => tls.connect({
          socket: connectedSocket,
          servername: target.hostname
        })
      });
    } else {
      req = http.request({
        ...common,
        createConnection: () => connectedSocket
      });
    }

    const timer = setTimeout(() => {
      req.destroy(new Error('Proxy request timed out'));
    }, timeoutMs);
    timer.unref?.();

    req.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    req.once('response', res => {
      clearTimeout(timer);
      resolve(res);
    });

    req.end();
  });
}

function requestHttpTargetViaHttpProxy(proxy, target, init, timeoutMs) {
  return new Promise((resolve, reject) => {
    const headers = normalizeHeaders(init.headers);
    headers.host ||= target.host;
    const auth = basicProxyAuth(proxy);
    if (auth) headers['proxy-authorization'] = auth;
    headers['user-agent'] ||= 'VOID-XMD/1.0';

    const transport = proxy.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: proxy.hostname,
      port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
      method: String(init.method || 'GET').toUpperCase(),
      path: target.href,
      headers,
      signal: init.signal
    });

    const timer = setTimeout(() => {
      req.destroy(new Error('Proxy request timed out'));
    }, timeoutMs);
    timer.unref?.();

    req.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    req.once('response', res => {
      clearTimeout(timer);
      resolve(res);
    });
    req.end();
  });
}

function responseFromIncoming(res) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }

  const body = res.req?.method === 'HEAD' ? null : Readable.toWeb(res);
  return new Response(body, {
    status: res.statusCode || 500,
    statusText: res.statusMessage || '',
    headers
  });
}

async function proxyRequest(input, init, proxyValue, redirectCount = 0) {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const proxy = new URL(proxyValue);
  const timeoutMs = Number(process.env.OUTBOUND_PROXY_TIMEOUT_MS || 20000);

  let res;

  if (/^socks5?:$/i.test(proxy.protocol)) {
    const socket = await connectSocks5(proxy, target, timeoutMs);
    res = await requestWithSocket(target, init, socket, timeoutMs);
  } else if (/^https?:$/i.test(proxy.protocol)) {
    if (target.protocol === 'http:') {
      res = await requestHttpTargetViaHttpProxy(proxy, target, init, timeoutMs);
    } else if (target.protocol === 'https:') {
      const socket = await connectHttpTunnel(proxy, target, timeoutMs);
      res = await requestWithSocket(target, init, socket, timeoutMs);
    } else {
      throw new Error(`Unsupported target protocol: ${target.protocol}`);
    }
  } else {
    throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
  }

  const status = res.statusCode || 0;
  const location = res.headers.location;

  if (
    location &&
    [301, 302, 303, 307, 308].includes(status) &&
    redirectCount < 5
  ) {
    res.resume();
    const next = new URL(location, target).href;
    return proxyRequest(next, init, proxyValue, redirectCount + 1);
  }

  return responseFromIncoming(res);
}

function shouldRetryResponse(response) {
  return retryStatuses().has(Number(response?.status));
}

export async function fetchViaProxy(input, init = {}, proxyValue) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    throw new Error(`Proxy fallback only retries safe GET/HEAD requests, not ${method}.`);
  }
  return proxyRequest(input, { ...init, method }, proxyValue);
}

export async function fetchWithFallback(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

  let directError;
  let lastResponse;

  try {
    const direct = await nativeFetch(input, init);
    if (!enabled() || !SAFE_METHODS.has(method) || !shouldRetryResponse(direct)) return direct;
    lastResponse = direct;
    try { await direct.body?.cancel(); } catch {}
  } catch (error) {
    directError = error;
    if (!enabled() || !SAFE_METHODS.has(method)) throw error;
  }

  const failures = [];

  for (const proxy of proxyUrls()) {
    try {
      const response = await fetchViaProxy(input, init, proxy);
      if (!shouldRetryResponse(response)) {
        return response;
      }
      lastResponse = response;
      try { await response.body?.cancel(); } catch {}
      failures.push(`${redactProxy(proxy)} returned HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${redactProxy(proxy)}: ${error.message}`);
    }
  }

  if (lastResponse) return lastResponse;

  const suffix = failures.length ? ` Proxy fallback: ${failures.join(' | ')}` : '';
  throw new Error(`${directError?.message || 'Direct request failed.'}${suffix}`);
}

export function installNetworkFallback() {
  if (globalThis.fetch === fetchWithFallback) return;
  globalThis.fetch = fetchWithFallback;
}

export function networkFallbackStatus() {
  return {
    enabled: enabled(),
    proxies: proxyUrls().map(redactProxy),
    retryStatuses: [...retryStatuses()].sort((a, b) => a - b),
    safeMethods: [...SAFE_METHODS]
  };
}
