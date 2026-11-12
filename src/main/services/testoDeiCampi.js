// Il testo scritto nei campi dei siti, tenuto sul computer finché non serve più (#2378): un file suo nella cartella dei
// dati, mai a un modello né fuori. Niente dall'incognito, dalle sessioni che non restano (Privacy), dalle pagine delicate
// e dai siti dove Filo è spento. Regole pure in src/shared/testoDeiCampi.js.

const path = require('node:path');
const Disco = require('./scritturaAtomica');
const R = require('../../shared/testoDeiCampi.js');
const PD = globalThis.SN_PAGINE_DELICATE || require('../../shared/pagineDelicate.js');
const N = require('../../shared/nomiSito.js');

const NOME_FILE = 'testo-dei-campi.json';
const RIPOSO_MS = 800;

let pagine = null;
let caricamento = null;
let timer = null;
let sporco = false;
// Pagina → la scheda che ne ha il testo davanti: finché è aperta lì, un'altra scheda sulla stessa pagina non lo riceve.
const padroni = new Map();
let fileFisso = null;

function file() {
  if (fileFisso) return fileFisso;
  return path.join(require('electron').app.getPath('userData'), NOME_FILE);
}

let giorniCorrenti = R.GIORNI_DI_SERIE;
function ora() { return Date.now(); }

function carica() {
  if (pagine) return Promise.resolve(pagine);
  if (!caricamento) {
    caricamento = (async () => {
      let letti = {};
      try {
        const buf = await Disco.leggi(file());
        if (buf) letti = JSON.parse(Disco.togliBom(buf.toString('utf8'))).pagine || {};
      } catch (_) {
        try { await Disco.mettiDaParte(file()); } catch (_) {}
        letti = {};
      }
      pagine = R.pota(letti, ora(), giorniCorrenti);
      return pagine;
    })().finally(() => { caricamento = null; });
  }
  return caricamento;
}

function contenuto() {
  return JSON.stringify({ v: 1, pagine: R.pota(pagine || {}, ora(), giorniCorrenti) });
}

function programma() {
  sporco = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    scriviOra().catch(() => {});
  }, RIPOSO_MS);
}

async function scriviOra() {
  if (!pagine || !sporco) return;
  sporco = false;
  try { await Disco.scrivi(file(), contenuto()); } catch (_) { sporco = true; }
}

// Alla chiusura di Filo: quello che aspettava il riposo va sul disco adesso.
function scriviSubito() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!pagine || !sporco) return;
  sporco = false;
  try { Disco.scriviSync(file(), contenuto()); } catch (_) { sporco = true; }
}
try {
  const { app } = require('electron');
  if (app && typeof app.on === 'function') for (const ev of ['before-quit', 'will-quit']) app.on(ev, scriviSubito);
} catch (_) {}

function elencoRemoto() {
  try { return require('./defaultsStore').get().sitiDelicati; } catch (_) { return null; }
}

// Una sessione che non resta (incognito, i siti non fidati in Privacy) non lascia niente sul disco, nemmeno questo.
function sessioneCheResta(sender) {
  if (!sender || sender.isIncognito) return false;
  try {
    const ses = sender.wc && sender.wc.session;
    if (!ses || (typeof ses.isPersistent === 'function' && !ses.isPersistent())) return false;
  } catch (_) { return false; }
  return true;
}

// La pagina del frame che parla, se qui il testo si conserva; '' altrimenti. Le delicate per un campo password visto
// non contano: quasi ogni sito con un accesso lo è, e lì si scrivono i messaggi.
function paginaAmmessa(sender, settings) {
  if (!R.opzioni(settings).attivo || !sessioneCheResta(sender)) return '';
  if (String((sender && sender.url) || '').startsWith('filo:')) return '';
  let url = '';
  try { url = String(sender.frame.url || ''); } catch (_) { url = ''; }
  const pagina = R.chiavePagina(url);
  if (!pagina) return '';
  const host = PD.host(pagina);
  const motivo = PD.classifica(pagina, {
    attivo: PD.attivo(settings), sitiUtente: PD.sitiUtente(settings), elenco: PD.elenco(elencoRemoto()), campi: null,
  });
  if (motivo) return '';
  const spenti = Array.isArray(settings && settings.blocklist) ? settings.blocklist.filter((x) => typeof x === 'string') : [];
  if (host && spenti.some((v) => { try { return N.copre(v, host); } catch (_) { return false; } })) return '';
  try { if (!require('./cookies').keepsSiteData(host)) return ''; } catch (_) {}
  return pagina;
}

function padroneAltrove(pagina, wc) {
  const id = padroni.get(pagina);
  if (!id || !wc || id === wc.id) return false;
  let altro = null;
  try { altro = require('electron').webContents.fromId(id); } catch (_) { altro = null; }
  if (!altro || altro.isDestroyed()) { padroni.delete(pagina); return false; }
  try {
    for (const f of altro.mainFrame.framesInSubtree) if (R.chiavePagina(f.url) === pagina) return true;
  } catch (_) {}
  padroni.delete(pagina);
  return false;
}

async function impostazioniAdesso() {
  try { return (await globalThis.SN_STORAGE.getSettings()) || {}; } catch (_) { return {}; }
}

async function leggi(sender, settings) {
  const pagina = paginaAmmessa(sender, settings);
  if (!pagina) return { ok: true, segui: false, campi: [] };
  await carica();
  const p = pagine[pagina];
  if (!p || padroneAltrove(pagina, sender.wc)) return { ok: true, segui: true, campi: [] };
  if (sender.wc) padroni.set(pagina, sender.wc.id);
  return { ok: true, segui: true, campi: p.campi.map((c) => ({ firma: c.firma, valore: c.valore })) };
}

async function scrivi(sender, settings, campi) {
  const pagina = paginaAmmessa(sender, settings);
  if (!pagina) return { ok: true, segui: false };
  await carica();
  const t = ora();
  let p = pagine[pagina] || null;
  const troppo = [];
  for (const c of (Array.isArray(campi) ? campi : []).slice(0, R.CAMPI_PER_PAGINA)) {
    const firma = R.firmaPulita(c && c.firma);
    if (!firma || typeof c.valore !== 'string') continue;
    // Oltre il tetto non si tiene niente di quel campo, e la pagina lo sa: mai un testo tagliato a metà.
    const valore = c.valore.length > R.VALORE_MAX ? '' : c.valore;
    if (c.valore.length > R.VALORE_MAX) troppo.push(firma);
    p = R.aggiorna(p, firma, /\S/.test(valore) ? valore : '', t);
  }
  if (p) pagine[pagina] = p; else delete pagine[pagina];
  if (sender.wc) padroni.set(pagina, sender.wc.id);
  programma();
  return { ok: true, segui: true, troppo: troppo.length };
}

async function daContenuto(msg, sender) {
  const settings = await impostazioniAdesso();
  giorniCorrenti = R.opzioni(settings).giorni;
  const fase = msg && msg.fase;
  if (fase === 'leggi') return leggi(sender, settings);
  if (fase === 'scrivi') return scrivi(sender, settings, msg.campi);
  return { ok: false };
}

function conta() {
  const lista = Object.values(R.pota(pagine || {}, ora(), giorniCorrenti));
  return { pagine: lista.length, campi: lista.reduce((n, p) => n + p.campi.length, 0) };
}

async function stato() {
  await carica();
  return { ok: true, ...conta() };
}

async function cancellaTutto() {
  await carica();
  pagine = {};
  padroni.clear();
  sporco = true;
  if (timer) { clearTimeout(timer); timer = null; }
  await scriviOra();
  return { ok: true, ...conta() };
}

// Spento, il testo già tenuto se ne va: riaccendendo non deve tornare quello di quando era spento. La durata accorciata
// toglie subito ciò che è già oltre.
function impostazioni(merged) {
  const o = R.opzioni(merged);
  const prima = giorniCorrenti;
  giorniCorrenti = o.giorni;
  if (!o.attivo) { cancellaTutto().catch(() => {}); return; }
  if (pagine && o.giorni < prima) {
    pagine = R.pota(pagine, ora(), giorniCorrenti);
    programma();
  }
}

module.exports = {
  daContenuto, stato, cancellaTutto, impostazioni, scriviSubito,
  _test: { paginaAmmessa, sessioneCheResta, usaFile: (f) => { fileFisso = f; pagine = null; padroni.clear(); } },
};
