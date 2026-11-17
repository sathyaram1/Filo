// Gli allegati di una segnalazione della chat (#1668), presi dalla conversazione e mai dal modello: le immagini
// ancora in memoria, i file delle righe «File:» dell'utente, l'ultima finestra guardata. Le regole sono in
// src/shared/allegatiSegnalazione.js; i tipi ammessi in src/shared/feedbackAttachTypes.js.

'use strict';

const fs = require('fs');
const path = require('path');

const AS = () => globalThis.SN_ALLEGATI_SEGNALAZIONE;

// Il tipo che dichiara un file letto dal disco: l'estensione è già passata da `classify`.
const MIME = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  txt: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv',
  tsv: 'text/tab-separated-values', json: 'application/json', yml: 'application/x-yaml', yaml: 'application/x-yaml',
  pdf: 'application/pdf',
});

async function conversazione(chatId) {
  const Chats = globalThis.SN_FILO_CHATS;
  let chat = null;
  try { chat = chatId && Chats ? await Chats.get(chatId) : null; } catch (_) { chat = null; }
  if (!chat) return { messaggi: [], fotoDi: () => null };
  const CF = require('./contestoFilo');
  const conFoto = CF.conFotoInMemoria(chat);
  return { messaggi: (conFoto && conFoto.messages) || [], fotoDi: (m) => m.fotoInMemoria || null };
}

// Un file della conversazione letto dal disco, col tetto controllato PRIMA di leggerlo.
async function leggiFile(v) {
  const Tipi = globalThis.SN_FEEDBACK_ATTACH;
  const genere = Tipi ? Tipi.classify({ name: v.nome, type: '' }) : null;
  if (!genere) return { ...v, problema: 'tipo di file non ammesso' };
  const ext = path.extname(v.nome).slice(1).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const tipo = genere === 'image' ? 'immagine' : 'file';
  let st;
  try { st = await fs.promises.stat(v.percorso); } catch (_) { return { ...v, tipo, type, problema: 'non si trova più sul computer' }; }
  if (!st.isFile()) return { ...v, tipo, type, problema: 'non è un file' };
  const tetto = AS().limiti().byte;
  if (st.size > tetto) return { ...v, tipo, type, byte: st.size, problema: AS().problemaDi({ ...v, dataUrl: 'x', byte: st.size }) };
  try {
    const buf = await fs.promises.readFile(v.percorso);
    return { ...v, tipo, type, byte: buf.length, dataUrl: `data:${type};base64,${buf.toString('base64')}` };
  } catch (_) {
    return { ...v, tipo, type, problema: 'non si legge' };
  }
}

// Le voci che partirebbero con l'azione, già pronte (byte compresi), e gli id indicati che nella chat non ci sono.
async function voci(action, chatId) {
  const { messaggi, fotoDi } = await conversazione(chatId);
  const inv = AS().inventario(messaggi, fotoDi);
  const CF = require('./contestoFilo');
  const { voci: scelte, scartati } = AS().scegli(action, inv, CF.schermataDi(chatId));
  const pronte = [];
  for (const v of scelte) pronte.push(v.tipo === 'file' ? await leggiFile(v) : v);
  return { voci: pronte, scartati };
}

// Per il riquadro di conferma: le anteprime, i limiti e quello che Filo ha indicato ma non c'è.
async function anteprima(action, chatId) {
  const { voci: v, scartati } = await voci(action, chatId);
  const L = AS().limiti();
  return { allegati: AS().anteprime(v), scartati, limiti: { immagini: L.immagini, file: L.file, byte: L.byte } };
}

module.exports = { voci, anteprima };
