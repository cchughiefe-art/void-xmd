import { store } from './store.js';
export const voiceLanguageCodes = 'en fr es ar de pt it zh ja ko hi ru tr nl yo ha sw id uk pl vi th bn ta te ur fa he'.split(' ');
let busy = false;
const MAX_BYTES = 6 * 1024 * 1024;
export function voiceAudio(raw) {
  const content = raw?.message?.ephemeralMessage?.message || raw?.message;
  return content?.audioMessage || null;
}
export async function transcribeVoice(audio, { fetcher = fetch, download, language = 'auto' } = {}) {
  if (language !== 'auto' && !voiceLanguageCodes.includes(language)) throw new Error('Voice language hint is unsupported. Use .voicelanguage auto.');
  if (busy) throw new Error('Another voice note is being processed. Please send text or try again shortly.');
  if (Number(audio.seconds || 0) > 180 || Number(audio.fileLength || 0) > MAX_BYTES) throw new Error('Please send a voice note under 3 minutes and 6 MB, or send text.');
  const key = store.getApiKey('groq') || process.env.GROQ_API_KEY;
  if (!key || store.getGlobal('groqEnabled', true) === false) throw new Error('Voice notes need a configured Groq provider. Please send text for now.');
  busy = true; let stream, timer;
  try {
    const loader = download || (await import('@whiskeysockets/baileys')).downloadContentFromMessage;
    stream = await loader(audio, 'audio', { options: { timeout: 20000 } });
    timer = setTimeout(() => stream.destroy(new Error('Voice download timed out.')), 20000); timer.unref?.();
    const chunks = []; let size = 0;
    for await (const chunk of stream) { size += chunk.length; if (size > MAX_BYTES) { stream.destroy(); throw new Error('That voice note is too large. Please send a shorter one.'); } chunks.push(chunk); }
    clearTimeout(timer);
    if (!size) throw new Error('The voice note was empty. Please send it again or type your message.');
    const mime = String(audio.mimetype || 'audio/ogg').split(';')[0];
    const types = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/webm': 'webm' };
    const ext = types[mime]; if (!ext) throw new Error('This audio format is unsupported. Please send a WhatsApp voice note or text.');
    const form = new FormData(); form.append('file', new Blob([Buffer.concat(chunks)], { type: mime }), `voice.${ext}`);
    form.append('model', 'whisper-large-v3-turbo'); form.append('response_format', 'json');
    if (language !== 'auto') form.append('language', language);
    const response = await fetcher('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(response.status === 429 ? 'Voice transcription has reached its current limit. Please send text.' : 'I could not transcribe that voice note. Please send text or try again later.');
    const result = await response.json(); const text = String(result.text || '').trim();
    if (!text) throw new Error('I could not make out the words. Please send text or a clearer recording.');
    return text.slice(0, 10000);
  } finally { clearTimeout(timer); stream?.destroy?.(); busy = false; }
}
