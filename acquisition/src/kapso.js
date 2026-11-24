// Intégration Kapso : vérification des webhooks et envoi de messages WhatsApp.
// Docs : https://docs.kapso.ai/docs/platform/webhooks/security
//        https://docs.kapso.ai/docs/getting-started/send-message-api
import crypto from 'node:crypto';
import { config, kapsoLive } from './config.js';

// Kapso signe le corps brut avec HMAC-SHA256 (hex) dans l'en-tête X-Webhook-Signature.
export function verifySignature(rawBody, signature, secret = config.kapsoWebhookSecret) {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export function sign(rawBody, secret = config.kapsoWebhookSecret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function post(payload) {
  const res = await fetch(`${config.kapsoBaseUrl}/${config.kapsoPhoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': config.kapsoApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kapso ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Envoi d'un texte. En mode démo (pas de clé Kapso), rien ne part : le message est seulement journalisé.
export async function sendText(to, body) {
  if (!kapsoLive()) return { simulated: true };
  return post({ to, type: 'text', text: { preview_url: false, body } });
}

// Message avec boutons de réponse (max 3 boutons, titre <= 20 caractères).
export async function sendButtons(to, body, buttons) {
  if (!kapsoLive()) return { simulated: true };
  return post({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  });
}

// Liste de choix (max 10 lignes ; titre <= 24 caractères, description <= 72, bouton <= 20).
export async function sendList(to, body, button, rows) {
  if (!kapsoLive()) return { simulated: true };
  return post({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: button.slice(0, 20),
        sections: [{ title: 'Choix', rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }],
      },
    },
  });
}

// Message modèle approuvé par Meta (seul envoi possible hors fenêtre de 24 h ; payant ; indisponible en sandbox).
export async function sendTemplate(to, name, params, language = 'fr') {
  if (!kapsoLive()) return { simulated: true };
  return post({
    to,
    type: 'template',
    template: { name, language: { code: language }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] },
  });
}

// Image par lien public (PNG/JPEG), avec légende.
export async function sendImage(to, link, caption) {
  if (!kapsoLive()) return { simulated: true };
  return post({ to, type: 'image', image: { link, ...(caption ? { caption } : {}) } });
}

// Marque le message comme lu et affiche « en train d'écrire » (disparaît à l'envoi de la réponse ou après ~25 s).
export async function showTyping(messageId) {
  if (!kapsoLive() || !messageId) return { simulated: true };
  const res = await fetch(`${config.kapsoBaseUrl}/${config.kapsoPhoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': config.kapsoApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }),
  });
  if (!res.ok) throw new Error(`Kapso ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Réaction emoji sur un message reçu (gratuite côté Meta).
export async function sendReaction(to, messageId, emoji) {
  if (!kapsoLive() || !messageId) return { simulated: true };
  return post({ to, type: 'reaction', reaction: { message_id: messageId, emoji } });
}

// Extrait les messages d'un payload webhook Kapso v2 (simple ou groupé).
export function extractMessages(payload) {
  const items = payload?.batch && Array.isArray(payload.data) ? payload.data : [payload];
  const out = [];
  for (const item of items) {
    const m = item?.message;
    if (!m) continue;
    const k = m.kapso || {};
    let kind = 'other';
    let body = null;
    let transcript = null;
    let buttonId = null;
    if (m.type === 'text') {
      kind = 'text';
      body = m.text?.body ?? k.content ?? '';
    } else if (m.type === 'audio') {
      kind = 'audio';
      transcript = k.transcript?.text || null; // transcription native Kapso
    } else if (m.type === 'interactive') {
      kind = 'interactive';
      buttonId = m.interactive?.button_reply?.id || m.interactive?.list_reply?.id || null;
      body = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || k.content || '';
    } else if (m.type === 'button') {
      kind = 'interactive';
      buttonId = m.button?.payload || null;
      body = m.button?.text || '';
    } else {
      body = k.content || null;
    }
    out.push({
      waMessageId: m.id,
      direction: k.direction || (m.from ? 'inbound' : 'outbound'),
      phone: (m.from || item.conversation?.phone_number || '').replace(/[^0-9]/g, ''),
      profileName: item.conversation?.contact_name || null,
      phoneNumberId: item.phone_number_id || item.conversation?.phone_number_id || null,
      kind,
      body,
      transcript,
      buttonId,
    });
  }
  return out;
}
