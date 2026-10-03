function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
  let digits = digitsOnly(value);

  // Convenience for Nigerian local numbers while preserving full
  // international numbers for every other country.
  if (/^0\d{10}$/.test(digits)) {
    digits = `234${digits.slice(1)}`;
  }

  if (digits.length < 8 || digits.length > 15) {
    throw new Error(
      'Enter a valid WhatsApp number with country code.\nExample: .getpp 2348066035334'
    );
  }

  return digits;
}

async function resolveTargetJid(sock, ctx) {
  const mentioned = ctx.mentions?.[0];
  if (mentioned) return mentioned;

  if (ctx.quoted?.participant) {
    return ctx.quoted.participant;
  }

  const phone = normalizePhone(ctx.args?.[0]);

  // Ask WhatsApp for the canonical JID first. This is more reliable than
  // blindly constructing @s.whatsapp.net on newer PN/LID-aware Baileys.
  try {
    const rows = await sock.onWhatsApp(`${phone}@s.whatsapp.net`);
    const found = Array.isArray(rows) ? rows.find(row => row?.exists !== false) : null;
    if (found?.jid) return found.jid;
  } catch {}

  // Fallback still works for ordinary phone-number JIDs.
  return `${phone}@s.whatsapp.net`;
}

async function profilePicture(sock, jid) {
  // Prefer full-size profile photo.
  try {
    return await sock.profilePictureUrl(jid, 'image');
  } catch {}

  // Some accounts only expose preview-size images.
  try {
    return await sock.profilePictureUrl(jid, 'preview');
  } catch {}

  // Compatibility fallback for Baileys builds that accept no second arg.
  try {
    return await sock.profilePictureUrl(jid);
  } catch {}

  return '';
}

export default {
  name: 'getpp',
  aliases: ['getdp', 'pp', 'avatar'],
  category: 'TOOLS',
  description: 'Get a WhatsApp profile picture by number, mention, or replied message',
  ownerOnly: false,

  async run(ctx) {
    const { sock, chat } = ctx;

    const hasTarget =
      Boolean(ctx.mentions?.[0]) ||
      Boolean(ctx.quoted?.participant) ||
      Boolean(ctx.args?.[0]);

    if (!hasTarget) {
      throw new Error(
        'Usage:\n' +
        '.getpp 2348066035334\n' +
        'or mention/reply to someone with .getpp'
      );
    }

    const jid = await resolveTargetJid(sock, ctx);
    const url = await profilePicture(sock, jid);

    if (!url) {
      throw new Error(
        'Profile picture unavailable. The number may have no profile photo, ' +
        'or their WhatsApp privacy settings may hide it from this bot account.'
      );
    }

    await sock.sendMessage(chat, {
      image: { url }
    });
  }
};
