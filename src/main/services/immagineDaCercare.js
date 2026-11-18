// Quale immagine cerca «cerca questa immagine» dalla chat (#2371): una mandata in questa chat, o la più grande in vista
// nella pagina. La sceglie Filo, mai un indirizzo scritto dal modello: Google Lens scarica quello che riceve, e un
// indirizzo scritto dal modello porterebbe fuori quello che c'è dentro. Prove: tests/chat-funzioni-segnalate.spec.mjs.
'use strict';

const { winOf, targetWebTab } = require('./handlersComuni');

async function immaginiDellaChat(chatId) {
  const Chats = globalThis.SN_FILO_CHATS;
  let chat = null;
  try { chat = chatId && Chats ? await Chats.get(chatId) : null; } catch (_) { chat = null; }
  if (!chat) return { immagini: [], contate: 0 };
  const conFoto = require('./contestoFilo').conFotoInMemoria(chat);
  const messaggi = (conFoto && conFoto.messages) || [];
  const inv = globalThis.SN_ALLEGATI_SEGNALAZIONE.inventario(messaggi, (m) => m.fotoInMemoria || null);
  const contate = messaggi.reduce((n, m) => n + (m && m.role === 'user' && !m.daModello ? Math.max(0, Math.floor(Number(m.images) || 0)) : 0), 0);
  return { immagini: inv.immagini, contate };
}

// La più grande in vista, dal mondo isolato: la pagina non può falsare document.images.
const PIU_GRANDE = `(() => {
  let best = '', area = 0;
  for (const im of Array.from(document.images)) {
    const s = im.currentSrc || im.src || '';
    if (!/^https?:/i.test(s)) continue;
    const r = im.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (w * h > area) { area = w * h; best = s; }
  }
  return best;
})()`;

async function immagineDellaPagina(tab) {
  if (!tab || tab.isInternal || !/^https?:\/\//i.test(tab.url || '') || !tab.view) return '';
  try {
    const s = await tab.view.webContents.executeJavaScriptInIsolatedWorld(1013, [{ code: PIU_GRANDE }]);
    return typeof s === 'string' && /^https?:\/\//i.test(s) ? s : '';
  } catch (_) { return ''; }
}

// { url } o { dataUrl, numero }, o { errore } da dire all'utente.
async function scegli(action, { sender, chatId, schedeViste } = {}) {
  const numero = Number(action.immagine ?? 0);
  if (action.immagine != null && (!Number.isInteger(numero) || numero <= 0)) return { errore: 'il numero dell\'immagine non è valido' };
  if (numero > 0 || (action.scheda == null)) {
    const { immagini, contate } = await immaginiDellaChat(chatId);
    if (numero > 0) {
      const im = immagini.find((x) => x.numero === numero);
      if (im) return { dataUrl: im.dataUrl, numero };
      return { errore: numero > contate ? `in questa chat non c'è l'immagine ${numero}` : `l'immagine ${numero} non è più in memoria: va mandata di nuovo` };
    }
    const ultima = immagini[immagini.length - 1];
    if (ultima) return { dataUrl: ultima.dataUrl, numero: ultima.numero };
  }
  let tab = null;
  if (action.scheda != null) {
    const tm = winOf(sender)?._filoTabs;
    const b = tm ? await require('./osservazioniPerModello').schedaPerNumero(tm, action, schedeViste) : null;
    if (!b || b.errore) return { errore: (b && b.errore) || 'numero di scheda non valido' };
    tab = b.tab;
  } else tab = targetWebTab(sender).tab;
  const url = await immagineDellaPagina(tab);
  return url ? { url } : { errore: 'nessuna immagine da cercare: né mandata in questa chat né in vista nella pagina' };
}

module.exports = { scegli };
