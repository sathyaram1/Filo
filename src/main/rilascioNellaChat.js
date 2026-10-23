// Le immagini lasciate sulla fila delle schede o sulla barra laterale (#1623) vanno alla chat della scheda davanti, come
// se le avessero lasciate lì: la home nel suo campo, le altre pagine all'Aiuto. Legge dal disco solo per un rilascio
// della nostra interfaccia, e solo immagini. Regole: patterns/un-file-lasciato-dove-la-pagina-non-lo-vuole-va-alla-chat.md

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { IMMAGINE_IN_LINEA: IN_LINEA } = require('./services/storiaAiuto');

const MIME = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
});
const CASA = /^filo:\/\/(newtab|dashboard)\b/i;

const allegati = () => globalThis.SN_CONST?.ALLEGATI_CHAT || {};
const tetto = () => allegati().tettoImmagineByte || 4 * 1024 * 1024;
const tettoLettura = () => allegati().tettoLetturaByte || 64 * 1024 * 1024;
const byteDi = (dataUrl) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);

// `voci`: [{ nome, percorso }] dal disco, [{ nome, dataUrl }] per le immagini senza file (da un'altra finestra),
// [{ nome, altro: true }] per un file che non è un'immagine e non ha percorso. Sopra il tetto un file entra col
// percorso nella home, che lo sa aprire; all'Aiuto va l'immagine intera, che la rimpicciolisce lui. Un file che non è
// un'immagine nella home entra col percorso come lasciato lì; all'Aiuto si conta, e il conto diventa un avviso.
async function prepara(voci, { casa }) {
  const immagini = [];
  const file = [];
  let grandi = 0;
  let altri = 0;
  for (const v of Array.isArray(voci) ? voci : []) {
    const nome = v && typeof v.nome === 'string' ? v.nome.slice(0, 260) : '';
    const percorso = v && typeof v.percorso === 'string' ? v.percorso : '';
    if (percorso) {
      if (!path.isAbsolute(percorso)) continue;
      const mime = MIME[path.extname(percorso).toLowerCase()];
      const st = await fs.stat(percorso).catch(() => null);
      if (!st || !st.isFile()) continue;
      if (!mime) {
        if (casa) file.push(percorso);
        else altri += 1;
        continue;
      }
      if (st.size > tetto() && (casa || st.size > tettoLettura())) {
        if (casa) file.push(percorso);
        else grandi += 1;
        continue;
      }
      const dati = await fs.readFile(percorso).catch(() => null);
      if (dati) immagini.push({ dataUrl: `data:${mime};base64,${dati.toString('base64')}`, nome: nome || path.basename(percorso), percorso: casa ? percorso : '' });
      continue;
    }
    if (v && v.altro === true) {
      if (!casa) altri += 1;
      continue;
    }
    const dataUrl = v && typeof v.dataUrl === 'string' ? v.dataUrl : '';
    if (!IN_LINEA.test(dataUrl)) continue;
    const byte = byteDi(dataUrl);
    if (byte > tetto() && (casa || byte > tettoLettura())) grandi += 1;
    else immagini.push({ dataUrl, nome, percorso: '' });
  }
  return { immagini, file, grandi, altri };
}

// Torna se la scheda davanti ha ricevuto qualcosa.
async function consegna(win, voci) {
  const tabs = win && win._filoTabs;
  const tab = tabs && tabs.tabs.find((t) => t.id === tabs.activeId);
  return allaScheda(tab, voci);
}

// Da un riquadro incorporato in un sito, al pannello della sua pagina: solo immagini già lette, mai un percorso,
// che il main andrebbe a leggere per conto di un sito.
function dalRiquadro(tab, voci) {
  const lette = (Array.isArray(voci) ? voci : []).map((v) => ({ nome: v && v.nome, dataUrl: v && v.dataUrl, altro: !!(v && v.altro === true) }));
  return allaScheda(tab, lette);
}

async function allaScheda(tab, voci) {
  const wc = tab && tab.view && tab.view.webContents;
  if (!wc || wc.isDestroyed()) return false;
  let url = tab.url || '';
  try { url = wc.getURL() || url; } catch (_) {}
  const casa = CASA.test(url);
  const cosa = await prepara(voci, { casa });
  if (!cosa.immagini.length && !cosa.file.length && !cosa.grandi && !cosa.altri) return false;
  if (wc.isDestroyed()) return false;
  try { wc.focus(); } catch (_) {}
  const tipo = globalThis.SN_MSG?.MSG?.CHAT_ALLEGA || 'chat_allega';
  try { wc.mainFrame.send('filo:broadcast', { type: tipo, dove: casa ? 'casa' : 'aiuto', ...cosa }); } catch (_) { return false; }
  return true;
}

module.exports = { consegna, dalRiquadro, prepara };
