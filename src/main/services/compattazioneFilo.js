// La compattazione del filo (SPEC-CONTESTO fase 4): riassume il pezzo più vecchio del tratto vivo nelle righe delle ore,
// una volta al giorno le ore nei giorni, e tiene le memorie proposte da un tratto sospetto finché l'utente non decide.
// Logica pura in src/shared/filoCompattazione.js; il tratto lo compone src/main/services/contestoFilo.js.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const L = () => globalThis.SN_FILO_COMPATTAZIONE;
const FC = () => globalThis.SN_FILO_CONTESTO;
const F = () => globalThis.SN_IL_FILO;
const CF = () => require('./contestoFilo');
const FILE = 'livelli.json';
const GIRO_GIORNI_MS = 60 * 60 * 1000;

const vuoto = () => ({ da: null, a: null, ore: [], giorni: [], inAttesa: [], guasto: 0 });
const stati = { normale: null, incognito: vuoto() };
let caricando = null;
const inCorso = { normale: null, incognito: null };
const ascoltatori = new Set();
let timerFermo = null;
let timerGiorni = null;

// `chiama({ messages, motivo, incognito })` → il testo del modello; `applicaMemoria(testo)` → scrive una memoria. Li dà
// il main all'avvio (handlers.js), le prove li sostituiscono.
const _dip = {
  chiama: null,
  applicaMemoria: async (testo) => {
    const P = globalThis.SN_PREF;
    const l = P ? P.lezioneDaAzione({ testo }) : { testo };
    if (l.rifiuto || !l.testo) return false;
    await globalThis.SN_FILO_MEMORY.appendLesson(l.testo);
    return true;
  },
  livello: async () => {
    let aut = {};
    try { aut = (await globalThis.SN_STORAGE.getSettings()).autonomia || {}; } catch (_) {}
    return aut;
  },
  cartella: () => path.join(process.env.FILO_USER_DATA || require('electron').app.getPath('userData'), 'filo'),
};

const lato = (incognito) => (incognito ? 'incognito' : 'normale');
const inIncognito = (v) => (v == null ? (() => { try { return require('../shim/storage').inIncognito(); } catch (_) { return false; } })() : !!v);
const id = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function carica() {
  if (stati.normale) return Promise.resolve(stati.normale);
  if (!caricando) {
    caricando = (async () => {
      let s = vuoto();
      try {
        const j = JSON.parse(await fsp.readFile(path.join(_dip.cartella(), FILE), 'utf8'));
        if (j && typeof j === 'object') {
          s = { ...s, ...j, ore: Array.isArray(j.ore) ? j.ore : [], giorni: Array.isArray(j.giorni) ? j.giorni : [], inAttesa: Array.isArray(j.inAttesa) ? j.inAttesa : [] };
        }
      } catch (e) {
        if (e && e.code !== 'ENOENT') console.warn('[Filo] livelli del filo non letti, riparto senza:', e?.message || e);
      }
      stati.normale = s;
      caricando = null;
      return s;
    })();
  }
  return caricando;
}

async function salva(incognito) {
  if (incognito) return;
  const s = stati.normale;
  if (!s) return;
  const dir = _dip.cartella();
  await fsp.mkdir(dir, { recursive: true });
  const f = path.join(dir, FILE);
  const tmp = `${f}.${process.pid}.tmp`;
  const { guasto, ...daScrivere } = s;
  await fsp.writeFile(tmp, JSON.stringify(daScrivere), 'utf8');
  await fsp.rename(tmp, f);
}

async function stato(incognito) {
  if (!incognito) await carica();
  return stati[lato(incognito)];
}

// Il pezzo di filo compattato, { da, a }: il tratto vivo comincia da `a` (contestoFilo.componi).
function compattato(incognito) {
  const s = stati[lato(inIncognito(incognito))];
  return s && s.a ? { da: s.da, a: s.a } : null;
}

// Una lettura sopra la soglia di pulito del livello di autonomia: chi compatta non ne vede il testo (§ Il sospetto, punto 1).
async function giudice() {
  const A = globalThis.SN_AUTONOMIA;
  const Lv = globalThis.SN_ACTION_LEVELS;
  const aut = await _dip.livello();
  const livello = A.livelloAttivo(aut.livello);
  const sopra = (fonti) => A.stato({ fonti, livello, spostamenti: aut.fonti, manopole: aut.manopole }).stato === 'contaminato';
  return {
    sospetta: (a) => {
      const f = Lv && Lv.fonteDi(a);
      // Una lettura senza classe dichiarata vale come una pagina: nel dubbio, il testo non passa.
      if (!f) return !!(Lv && Lv.diSolaLettura(a && a.type)) && a.type !== 'LEGGI_IMPOSTAZIONI' && a.type !== 'CAPACITA_DETTAGLIO' && a.type !== 'LEGGI_TRASPARENZA';
      return sopra([f]);
    },
    classeSospetta: (c) => sopra([{ classe: c, campo: 'web', chiave: 'filo:tratto', motivo: '' }]),
  };
}

// I messaggi del filo che il tratto può ancora avere davanti e non sono compattati, in ordine di tempo.
async function daCompattare(incognito, { ora, tetti }) {
  const s = await stato(incognito);
  const tutti = CF().messaggiDi(await F().chats({ incognito }));
  const inizio = s.a ? Date.parse(s.a) : FC().taglio(ora, tetti.giorni);
  return tutti.filter((m) => Date.parse(m.ts) >= inizio && Date.parse(m.ts) <= ora);
}

// Compatta il pezzo più vecchio del tratto vivo. `grezzo`: { ore, turni } che restano grezzi (le costanti di serie se
// mancano). Ritorna { fatto, motivo, ricevuto, ore, memorie, inAttesa }. Due richieste insieme fanno una compattazione sola.
function compatta(opts = {}) {
  const incognito = inIncognito(opts.incognito);
  const k = lato(incognito);
  if (inCorso[k]) return inCorso[k];
  inCorso[k] = (async () => {
    try { return await compattaOra({ ...opts, incognito }); } finally { inCorso[k] = null; }
  })();
  return inCorso[k];
}

async function compattaOra({ incognito, motivo = 'soglia', ora = Date.now(), tetti = null, grezzo = null, forza = false }) {
  const s = await stato(incognito);
  if (!forza && s.guasto && ora - s.guasto < L().PAUSA_DOPO_GUASTO_MS) return { fatto: false, motivo: 'pausa' };
  if (typeof _dip.chiama !== 'function') return { fatto: false, motivo: 'senza_modello' };
  const t = tetti || FC().tetti(null, null);
  const lista = await daCompattare(incognito, { ora, tetti: t });
  const taglio = L().puntoDiTaglio(lista, { ora, ore: grezzo && grezzo.ore != null ? grezzo.ore : L().ORE_GREZZE, turni: grezzo && grezzo.turni != null ? grezzo.turni : L().TURNI_GREZZI });
  // Un pezzo enorme (il primo giro su giorni di filo mai compattati) va a pezzi: il resto lo prende la prossima.
  let fine = 0;
  let peso = 0;
  while (fine < taglio) {
    const m = lista[fine];
    let p = String(m.text || '').length;
    if (m.role !== 'user') for (const a of CF().esitiPerCompattare(m).azioni) p += 200 + String((a && a._output && a._output.titolo) || '').length;
    if (fine > 0 && peso + p > L().MAX_INGRESSO * FC().CARATTERI_PER_TOKEN) break;
    peso += p;
    fine++;
  }
  while (fine > 0 && fine < taglio && lista[fine].role !== 'user') fine--;
  if (fine === 0 && taglio > 0) fine = taglio;
  const pezzo = lista.slice(0, fine);
  if (!pezzo.length) return { fatto: false, motivo: 'niente' };
  const g = await giudice();
  const { righe, sospetto } = L().righePerChiCompatta(pezzo, {
    esiti: CF().esitiPerCompattare, preambolo: CF().preamboloPerCompattare, sospetta: g.sospetta, classeSospetta: g.classeSospetta,
  });
  const foto = CF().ultimaFotografia(incognito);
  const messages = L().richiesta({ parteUtente: foto ? foto.testo : '', righe });
  let testo = '';
  try {
    testo = String(await _dip.chiama({ messages, motivo, incognito }) || '');
  } catch (e) {
    s.guasto = ora;
    console.warn('[Filo] compattazione non riuscita, il tratto resta com\'è:', e?.message || e);
    return { fatto: false, motivo: 'guasto', errore: e };
  }
  const letto = L().leggiRisposta(testo, righe, { id });
  if (!letto) {
    s.guasto = ora;
    console.warn('[Filo] compattazione: risposta illeggibile, il tratto resta com\'è');
    return { fatto: false, motivo: 'illeggibile' };
  }
  // Le cose successe nel pezzo (pagine, azioni fuori dalla chat) vanno con la riga delle ore della loro ora: tolte dal
  // filo, la riga esce con loro.
  try {
    const eventi = await CF().eventiDa(pezzo[0].ts, incognito);
    const limite = Date.parse(lista[fine] ? lista[fine].ts : pezzo[pezzo.length - 1].ts);
    for (const ev of eventi) {
      const t0 = Date.parse(ev && ev.ts);
      if (!ev || !ev.id || !Number.isFinite(t0) || t0 >= limite || ev.tipo === 'cambio') continue;
      const r = letto.ore.find((o) => t0 <= Date.parse(o.a)) || letto.ore[letto.ore.length - 1];
      if (!r.fonti.includes(ev.id)) r.fonti.push(ev.id);
    }
  } catch (_) {}
  const prima = { a: s.a, da: s.da };
  s.ore.push(...letto.ore);
  s.da = s.da || letto.ore[0].da;
  s.a = lista[fine] ? lista[fine].ts : new Date(Date.parse(pezzo[pezzo.length - 1].ts) + 1).toISOString();
  s.guasto = 0;
  const inAttesa = [];
  let scritte = 0;
  // Da un tratto sospetto le memorie si propongono soltanto (§ Il sospetto, punto 4); dall'incognito nessuna.
  if (!incognito) {
    for (const m of letto.memorie) {
      if (sospetto) {
        const p = { id: id(), testo: m, ts: new Date(ora).toISOString() };
        s.inAttesa.push(p);
        inAttesa.push(p);
      } else {
        try { if (await _dip.applicaMemoria(m)) scritte++; } catch (e) { console.warn('[Filo] memoria della compattazione non scritta:', e?.message || e); }
      }
    }
  }
  try { await salva(incognito); } catch (e) {
    s.ore.splice(s.ore.length - letto.ore.length, letto.ore.length);
    s.a = prima.a;
    s.da = prima.da;
    console.warn('[Filo] livelli del filo non salvati, il tratto resta com\'è:', e?.message || e);
    return { fatto: false, motivo: 'disco' };
  }
  CF().riparti(incognito);
  for (const fn of ascoltatori) { try { fn({ incognito, fino: s.a, motivo, inAttesa: inAttesa.length }); } catch (_) {} }
  // Una proposta che aspetta e nessuno la vede aspetterebbe per sempre: lo si dice una volta, col salto al quaderno.
  if (inAttesa.length) {
    try {
      require('./avvisoFinestra').avvisoQuandoPronta(
        inAttesa.length === 1 ? 'Ho una cosa da ricordare che aspetta il tuo sì: è nel quaderno delle memorie.' : `Ho ${inAttesa.length} cose da ricordare che aspettano il tuo sì: sono nel quaderno delle memorie.`,
        { chiave: 'memorie-in-attesa', tipo: 'memorie_in_attesa', azioni: [{ label: 'Apri il quaderno', openUrl: 'filo://quaderno/quaderno.html' }] },
      );
    } catch (_) {}
  }
  return {
    fatto: true, motivo, ricevuto: messages.map((x) => x.content).join('\n\n'), ore: letto.ore, memorie: letto.memorie, inAttesa, scritte,
    fino: s.a, sospetto,
  };
}

// Chi tiene copie di quello che il tratto ha letto (le fonti delle chat) le pota quando il tratto si chiude.
function suCompattazione(fn) { if (typeof fn === 'function') ascoltatori.add(fn); return () => ascoltatori.delete(fn); }

// Il livello «giorni»: una riga per ogni giorno passato che ha ore e non ancora la sua riga.
async function riassumiGiorni({ incognito = false, ora = Date.now() } = {}) {
  const s = await stato(incognito);
  if (typeof _dip.chiama !== 'function') return 0;
  let fatti = 0;
  for (const giorno of L().giorniDaRiassumere(s.ore, s.giorni, ora)) {
    const ore = s.ore.filter((r) => L().giornoDi(r.a) === giorno);
    let riga = '';
    try { riga = L().leggiGiorno(await _dip.chiama({ messages: L().richiestaGiorno(giorno, ore), motivo: 'giorni', incognito })); } catch (e) {
      console.warn('[Filo] riassunto del giorno non riuscito, riprovo al prossimo giro:', e?.message || e);
      break;
    }
    if (!riga) continue;
    s.giorni.push({ id: id(), giorno, testo: riga, ore: ore.map((r) => r.id), fonti: [...new Set(ore.flatMap((r) => r.fonti || []))] });
    fatti++;
  }
  if (fatti) { try { await salva(incognito); } catch (e) { console.warn('[Filo] livelli del filo non salvati:', e?.message || e); } }
  return fatti;
}

// La sezione del CONTESTO: giorni e ore che il filo ha ancora. Una riga nata da una conversazione o una pagina
// cancellata esce, anche dal disco: quello che è cancellato non torna dal riassunto (#868.1).
async function sezione(incognito) {
  incognito = inIncognito(incognito);
  const s = await stato(incognito);
  if (!s.ore.length && !s.giorni.length) return '';
  const chats = new Set((await F().chats({ incognito })).map((c) => c && c.id));
  // Le pagine e gli accaduti si rileggono solo dopo una cancellazione nuova; se non si leggono, non si toglie niente.
  let eventi = null;
  let tolte = null;
  try { tolte = await F().cancellazioni({ incognito }); } catch (_) { tolte = null; }
  if (tolte != null && tolte !== s.tolte && s.da) {
    try {
      const [acc, pag] = await Promise.all([F().accaduti({ da: s.da }, { incognito }), F().pagine({ da: s.da, a: null }, { incognito })]);
      eventi = new Set([...acc, ...pag].map((ev) => ev && ev.id));
      s.tolte = tolte;
    } catch (_) { eventi = null; }
  }
  const vivo = (f) => (String(f).includes('|') ? chats.has(String(f).split('|')[0]) : (!eventi || eventi.has(f)));
  const ore = L().senzaCancellate(s.ore, vivo);
  const giorni = L().senzaCancellate(s.giorni, vivo);
  if (ore.length !== s.ore.length || giorni.length !== s.giorni.length) {
    s.ore = ore;
    s.giorni = giorni;
    try { await salva(incognito); } catch (_) {}
  }
  return L().rendiFiloCompattato({ ore, giorni });
}

// Quanto pesa il tratto vivo, senza comporlo: testi ed esiti dei messaggi dopo il punto compattato.
async function tokenDelTratto(incognito, { ora = Date.now(), tetti = null } = {}) {
  const lista = await daCompattare(!!incognito, { ora, tetti: tetti || FC().tetti(null, null) });
  let caratteri = 0;
  for (const m of lista) {
    caratteri += String(m.text || '').length;
    if (m.role !== 'user') {
      for (const a of CF().esitiPerCompattare(m).azioni) { try { caratteri += JSON.stringify(a._output || '').length; } catch (_) {} }
    }
  }
  return Math.ceil(caratteri / FC().CARATTERI_PER_TOKEN);
}

async function righe(incognito) {
  const s = await stato(inIncognito(incognito));
  return { ore: s.ore.slice(), giorni: s.giorni.slice(), da: s.da, a: s.a };
}

// ── Le memorie proposte da un tratto sospetto: aspettano l'utente ──────────
async function inAttesa() {
  return (await stato(false)).inAttesa.slice();
}
async function decidi(idProposta, tieni) {
  const s = await stato(false);
  const i = s.inAttesa.findIndex((p) => p && p.id === idProposta);
  if (i < 0) return { ok: false };
  const [p] = s.inAttesa.splice(i, 1);
  let scritta = false;
  if (tieni) {
    try { scritta = await _dip.applicaMemoria(p.testo); } catch (e) { s.inAttesa.splice(i, 0, p); throw e; }
  }
  await salva(false);
  return { ok: true, scritta };
}

// ── Le porte che non sono una richiesta: fermo e giorni ─────────────────────
// `fn` null: un turno è cominciato, la compattazione da fermo non parte sotto di lui.
function programmaFermo(fn, ms) {
  if (timerFermo) clearTimeout(timerFermo);
  timerFermo = null;
  if (typeof fn !== 'function') return;
  timerFermo = setTimeout(() => { timerFermo = null; Promise.resolve().then(fn).catch((e) => console.warn('[Filo] compattazione da fermo:', e?.message || e)); }, ms);
  if (timerFermo.unref) timerFermo.unref();
}
function avvia() {
  if (timerGiorni) return;
  const giro = () => riassumiGiorni().catch((e) => console.warn('[Filo] giro dei giorni:', e?.message || e));
  timerGiorni = setInterval(giro, GIRO_GIORNI_MS);
  if (timerGiorni.unref) timerGiorni.unref();
  const primo = setTimeout(giro, 2 * 60 * 1000);
  if (primo.unref) primo.unref();
}

function dimenticaIncognito() { stati.incognito = vuoto(); }
// Le prove ripartono da un filo nuovo.
function azzera() { stati.normale = null; stati.incognito = vuoto(); caricando = null; }
function imposta(dip) { Object.assign(_dip, dip || {}); }

module.exports = {
  _dip, imposta, carica, compattato, compatta, riassumiGiorni, sezione, righe, tokenDelTratto, inAttesa, decidi, suCompattazione,
  programmaFermo, avvia, dimenticaIncognito, azzera,
};
globalThis.SN_COMPATTAZIONE = module.exports;
