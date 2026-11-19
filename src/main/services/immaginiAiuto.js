// Le immagini che l'utente ha dato all'Aiuto, per impronta e per mittente (#1664): una segnalazione dell'Aiuto allega
// solo quelle già mandate al modello in quella conversazione, mai byte nuovi arrivati con la conferma.
// Regole degli allegati: src/shared/allegatiSegnalazione.js.

'use strict';

const crypto = require('crypto');
const { senderKey } = require('./porteUscita');

const viste = new Map();
const PER_MITTENTE = 64;
const MITTENTI = 64;
const impronta = (u) => crypto.createHash('sha256').update(String(u)).digest('hex');
const IMMAGINE = /^data:image\/(png|jpeg|webp|gif);base64,/i;

// Le immagini allegate dall'utente stanno nella cronologia come parti image_url dei suoi messaggi (sidebar.js).
function ricorda(sender, payload) {
  const storia = payload && Array.isArray(payload.history) ? payload.history : [];
  const k = senderKey(sender);
  for (const m of storia) {
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const c of m.content) {
      const u = c && c.type === 'image_url' && c.image_url ? String(c.image_url.url || '') : '';
      if (!IMMAGINE.test(u)) continue;
      const s = viste.get(k) || new Set();
      viste.delete(k);
      s.add(impronta(u));
      while (s.size > PER_MITTENTE) s.delete(s.values().next().value);
      viste.set(k, s);
      while (viste.size > MITTENTI) viste.delete(viste.keys().next().value);
    }
  }
}

// { id: dataUrl } ridotto a quelle che questo mittente ha davvero mandato al modello.
function soloViste(sender, immagini) {
  const s = viste.get(senderKey(sender));
  const fuori = {};
  if (!s || !immagini || typeof immagini !== 'object') return fuori;
  for (const [id, u] of Object.entries(immagini)) {
    if (/^immagine:\d+$/.test(id) && typeof u === 'string' && IMMAGINE.test(u) && s.has(impronta(u))) fuori[id] = u;
  }
  return fuori;
}

module.exports = { ricorda, soloViste };
