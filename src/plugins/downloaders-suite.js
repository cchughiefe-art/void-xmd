import fetch from 'node-fetch';

const downloadCommands = [
  'play', 'play2', 'playdoc', 'playch', 'video', 'video2', 'videodoc', 'song', 
  'fbdl', 'twitter', 'igdl', 'pinterestdl', 'douyin', 'aio', 'gdrive', 'mediafire', 
  'snackvideo', 'soundcloud', 'spotify', 'webdl', 'apk', 'savetube', 'videy', 
  'xnxxdl', 'xxxdl', 'dlanime', 'animedl', 'dlmovie', 'dlseries', 'ytmp3', 'ytmp4'
];

export default downloadCommands.map(cmd => ({
  name: cmd,
  category: 'DOWNLOADER',
  description: `Downloads media or files using ${cmd}`,
  async run({ reply, text, sock, chat, raw }) {
    if (!text) {
      throw new Error(`Usage: .${cmd} <url or search query>`);
    }

    await reply(`⏳ Processing your ${cmd} request... Please wait.`);

    try {
      // Functional routing via public multi-downloader APIs
      const apiURL = `https://apis.davidcyriltech.space/api/${cmd}?url=${encodeURIComponent(text)}`;
      const response = await fetch(apiURL);
      const json = await response.json();

      if (!json || (!json.status && !json.result && !json.download)) {
        throw new Error(`Failed to retrieve downloadable content for ${text}.`);
      }

      const mediaUrl = json.result?.url || json.download || json.result;

      if (cmd.includes('song') || cmd.includes('play') || cmd.includes('mp3')) {
        await sock.sendMessage(chat, { audio: { url: mediaUrl }, mimetype: 'audio/mpeg', ptt: false }, { quoted: raw });
      } else {
        await sock.sendMessage(chat, { video: { url: mediaUrl }, caption: `✅ Downloaded successfully via .${cmd}` }, { quoted: raw });
      }
    } catch (err) {
      console.error(`Error in ${cmd}:`, err);
      // Fallback response if external API is unreachable
      await reply(`❌ Error processing download. Please check your link or search parameter.`);
    }
  }
}));

