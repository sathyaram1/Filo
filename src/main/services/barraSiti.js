// La barra dei siti della nuova scheda (#1803): la legge e la scrive solo da qui, una mossa alla volta, per i gesti
// della home e per la chat. Avvia solo un programma che è già una voce della barra, cercato per id: mai un percorso
// arrivato con la richiesta di avvio. Mosse in src/shared/barraSiti.js; regole in tests/unit/barraSiti.test.mjs.

const fs = require('fs');
const path = require('path');

function Barra() { return globalThis.SN_BARRA_SITI; }
function chiave() { return globalThis.SN_CONST.STORAGE_KEYS.FILO_BARRA_SITI; }

async function leggi() {
  let raw = null;
  try { raw = (await chrome.storage.local.get(chiave()))[chiave()]; } catch (_) {}
  return Barra().normalizza(raw);
}

// Un file che un clic sa avviare su questa piattaforma, o il perché no. Un ramo per piattaforma, tutti interi.
function controllaProgramma(percorso, piattaforma = process.platform) {
  const p = String(percorso || '');
  if (!p || !path.isAbsolute(p)) return { errore: 'serve il percorso intero del programma' };
  let st;
  try { st = fs.statSync(p); } catch (_) { return { errore: 'il programma non c\'è più in quel punto del computer' }; }
  const ext = Barra().estensione(p);
  if (piattaforma === 'win32') {
    if (st.isFile() && ['lnk', 'exe', 'url', 'appref-ms'].includes(ext)) return { ok: true };
    return { errore: 'nella barra va un programma o un suo collegamento (.exe, .lnk, .url)' };
  }
  if (piattaforma === 'darwin') {
    if (ext === 'app' && st.isDirectory()) return { ok: true };
    if (st.isFile() && (st.mode & 0o111)) return { ok: true };
    return { errore: 'nella barra va un\'applicazione (.app)' };
  }
  if (st.isFile() && (ext === 'desktop' || (st.mode & 0o111))) return { ok: true };
  return { errore: 'nella barra va un programma, un suo lanciatore (.desktop) o un file eseguibile' };
}

async function iconaDelProgramma(percorso) {
  try {
    const img = await require('electron').app.getFileIcon(percorso, { size: 'normal' });
    return img && !img.isEmpty() ? img.toDataURL() : '';
  } catch (_) { return ''; }
}

// Due mosse quasi insieme (due home, la chat e un trascinamento) leggerebbero la stessa barra e la seconda
// cancellerebbe la prima: si mettono in fila.
let coda = Promise.resolve();
async function modifica(mossa) {
  const m = mossa && typeof mossa === 'object' ? { ...mossa } : {};
  if (m.tipo === 'aggiungi' && m.percorso) {
    const c = controllaProgramma(m.percorso);
    if (c.errore) return { voci: await leggi(), cambiato: false, errore: c.errore };
    if (!m.icona) m.icona = await iconaDelProgramma(m.percorso);
  }
  const giro = coda.then(async () => {
    const esito = Barra().applica(await leggi(), m);
    if (esito.cambiato) await chrome.storage.local.set({ [chiave()]: esito.voci });
    return esito;
  });
  coda = giro.catch(() => {});
  return giro;
}

// L'azione BARRA_SITI della chat: la stessa mossa dei gesti, dallo stesso `modifica`. Torna l'esito per il dispatch
// e, se la barra è cambiata, le voci da annunciare.
async function daChat(action) {
  const B = Barra();
  const a = action && typeof action === 'object' ? action : {};
  const tipo = B.operazione(a);
  if (!tipo) return { executed: false, kept: false, output: { error: 'operazione sconosciuta' } };
  if (tipo === 'elenca') return { executed: true, kept: false, output: { voci: B.descrivi(await leggi()) } };
  const chi = tipo === 'rinomina' ? (a.voce ?? a.indirizzo) : (a.voce ?? a.indirizzo ?? a.nome);
  const mossa = {
    tipo,
    url: a.indirizzo ?? a.url ?? '',
    percorso: tipo === 'aggiungi' ? String(a.percorso ?? '').trim() : '',
    nome: a.nome ?? '',
    voce: chi ?? '',
    verso: a.verso,
    ...(a.prima_di != null && a.prima_di !== '' ? { prima: a.prima_di } : {}),
  };
  const esito = await modifica(mossa);
  const voci = B.descrivi(esito.voci);
  if (esito.errore) return { executed: false, kept: false, output: { error: esito.errore, voci } };
  return {
    executed: true,
    kept: true,
    output: { voci, ...(esito.voce ? { voce: esito.voce.nome } : {}), ...(esito.gia ? { gia: true } : {}) },
    ...(esito.cambiato ? { cambiate: esito.voci } : {}),
  };
}

function lancia(percorso, piattaforma = process.platform) {
  const { shell } = require('electron');
  const { spawn, execFile } = require('child_process');
  const staccato = (cmd, args) => new Promise((resolve) => {
    try {
      const figlio = spawn(cmd, args, { detached: true, stdio: 'ignore', cwd: path.dirname(percorso) });
      figlio.once('error', (e) => resolve(e && e.message ? e.message : 'non partito'));
      figlio.once('spawn', () => { figlio.unref(); resolve(''); });
    } catch (e) { resolve(e.message); }
  });
  if (piattaforma === 'win32') return shell.openPath(percorso);
  if (piattaforma === 'darwin') {
    if (Barra().estensione(percorso) === 'app') return shell.openPath(percorso);
    return staccato(percorso, []);
  }
  // Linux: un lanciatore .desktop lo avvia gio, che legge Exec come il desktop; un eseguibile parte da sé.
  if (Barra().estensione(percorso) === 'desktop') {
    return new Promise((resolve) => {
      execFile('gio', ['launch', percorso], { timeout: 15000 }, (err) => {
        if (!err) return resolve('');
        resolve(err.code === 'ENOENT' ? 'manca «gio» per avviare i lanciatori .desktop' : (err.message || 'non partito'));
      });
    });
  }
  return staccato(percorso, []);
}

// Il clic su una voce-programma: il percorso viene dalla barra salvata, l'id dalla pagina.
async function avvia(id, { lanciatore = lancia } = {}) {
  const voce = (await leggi()).find((v) => v.id === String(id || ''));
  if (!voce || voce.tipo !== 'app') return { ok: false, error: 'questa voce non è un programma della barra' };
  const c = controllaProgramma(voce.percorso);
  if (c.errore) return { ok: false, error: c.errore };
  const e = await lanciatore(voce.percorso);
  return e ? { ok: false, error: `${voce.nome} non è partito: ${e}` } : { ok: true, nome: voce.nome };
}

module.exports = { leggi, modifica, avvia, controllaProgramma };
