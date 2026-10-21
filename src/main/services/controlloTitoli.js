// I titoli delle schede nel main (#927): quali entrano nel riepilogo della chat, e il box per quelli sospetti.
// La regola sta in src/shared/titoliSchede.js; il box lo disegnano gli avvisi della barra (shell.js). Dall'incognito
// non si scrive niente su disco e non si condivide niente. Prove: tests/unit/controlloTitoli.test.mjs, tests/titoli-schede.spec.mjs.

const { randomUUID } = require('node:crypto');
const Defaults = require('./defaultsStore');

function T() {
  if (!globalThis.SN_TITOLI_SCHEDE) require('../../shared/titoliSchede.js');
  return globalThis.SN_TITOLI_SCHEDE;
}
const chiaveDisco = () => (globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS.TITOLI_SCHEDE_RISPOSTE) || 'filo_titoli_schede_risposte';

// Un titolo entra nel riepilogo come fonte di classe 2 del web: solo dove quella classe lascia il compito pulito.
const FONTE = Object.freeze({ classe: 2, campo: 'web', chiave: 'schede:titoli', motivo: 'ho letto i titoli delle schede aperte' });

// Le risposte dell'utente, per titolo e sito: { r: 'no' } lo fa entrare, { r: 'si' } lo tiene fuori, e nessuna delle due
// riapre il box. Si vedono e si tolgono in Preferenze. Il tetto tiene le più recenti: una più vecchia che ricompare
// richiede di nuovo una risposta.
const TETTO_RISPOSTE = 5000;
let risposte = null;
let caricate = null;
const risposteEffimere = new Map();
const chiesti = new Set();
const inAttesa = new Map();
// Box chiusi senza risposta: non si riaprono a ogni cambio di titolo, ma tornano quando la pagina si ricarica.
const chiusi = new Set();
// Il riepilogo rilegge tutte le schede a ogni messaggio: l'esito della regola si ricorda per titolo e versione.
const memo = new Map();
let inviaTitolo = null;
let posaPerProve = null;

const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

function voce(titolo, url) {
  return `${T().sito(url)}\n${T().chiave(titolo)}`;
}

function carica() {
  if (!caricate) {
    caricate = Promise.resolve().then(async () => {
      const salvate = await globalThis.SN_STORAGE.getRaw(chiaveDisco(), {});
      const m = new Map();
      if (salvate && typeof salvate === 'object' && !Array.isArray(salvate)) {
        for (const [k, v] of Object.entries(salvate)) {
          if (v && (v.r === 'si' || v.r === 'no')) m.set(k, { r: v.r, titolo: String(v.titolo || ''), sito: String(v.sito || '') });
        }
      }
      // Una risposta data mentre si leggeva il disco vince su quella salvata.
      if (risposte) for (const [k, v] of risposte) { m.delete(k); m.set(k, v); }
      risposte = m;
    }).catch(() => { caricate = null; if (!risposte) risposte = new Map(); });
  }
  return caricate;
}

async function salva() {
  if (!risposte) return;
  while (risposte.size > TETTO_RISPOSTE) risposte.delete(risposte.keys().next().value);
  try { await globalThis.SN_STORAGE.setRaw(chiaveDisco(), Object.fromEntries(risposte)); } catch (_) {}
}

function risposta(k) {
  const v = risposteEffimere.get(k) || (risposte && risposte.get(k));
  return v ? v.r : undefined;
}

// Per Preferenze: tutte le risposte, le più recenti prima. Quelle date in incognito valgono fino alla chiusura di Filo.
async function elenco() {
  await carica();
  const fuori = (m, incognito) => [...m].map(([k, v]) => ({ voce: k, titolo: v.titolo, sito: v.sito, risposta: v.r, incognito }));
  return [...fuori(risposteEffimere, true), ...fuori(risposte || new Map(), false)].reverse();
}

// Tolta la risposta, il titolo torna a passare dalla regola: se è sospetto resta fuori e il box si riapre.
async function dimentica(k) {
  await carica();
  const chiave = String(k || '');
  const c = risposteEffimere.delete(chiave);
  const d = risposte ? risposte.delete(chiave) : false;
  chiesti.delete(chiave);
  if (d) await salva();
  return c || d;
}

async function impostazioni(s) {
  if (s) return s;
  try { return (await globalThis.SN_STORAGE.getSettings()) || {}; } catch (_) { return {}; }
}

// 'controlla': i titoli passano dalla regola; 'sito': entra solo il nome del sito (livello che non tiene pulita la
// classe 2, o interruttore spento in Preferenze).
function modo(settings) {
  const s = settings || {};
  if (s.titoliSchede && s.titoliSchede.controlla === false) return 'sito';
  const A = globalThis.SN_AUTONOMIA;
  if (!A) return 'sito';
  const aut = s.autonomia || {};
  const st = A.stato({ fonti: [FONTE], livello: A.livelloAttivo(aut.livello), spostamenti: aut.fonti, manopole: aut.manopole });
  return st.stato === 'pulito' ? 'controlla' : 'sito';
}

function condivisioneChiesta(settings) {
  return !(settings && settings.titoliSchede && settings.titoliSchede.chiediCondivisione === false);
}

// Il filtro del riepilogo: per una scheda, `null` se il titolo entra, altrimenti il motivo per cui passa solo il sito.
async function filtro(settingsIn) {
  const settings = await impostazioni(settingsIn);
  await carica();
  const m = modo(settings);
  const regola = Defaults.regolaTitoli() || T().REGOLA;
  // Un titolo con l'ordine dentro resta fuori anche quando il box non si apre (un ordine fra virgolette, una notizia).
  const sospetto = (titolo, k) => {
    const m2 = `${regola.versione || ''}\n${k}`;
    if (!memo.has(m2)) {
      if (memo.size > 2000) memo.clear();
      const e = T().controlla(titolo, regola);
      memo.set(m2, e.sospetto ? 'sospetto' : e.fuori ? 'citato' : null);
    }
    return memo.get(m2);
  };
  const f = (tab) => {
    // Le pagine di Filo hanno il titolo che scrive Filo.
    if (/^filo:/i.test(String((tab && tab.url) || ''))) return null;
    if (m === 'sito') return 'sito';
    const titolo = tab && tab.title;
    if (!titolo) return null;
    const k = voce(titolo, tab.url);
    const r = risposta(k);
    if (r === 'no') return null;
    if (r === 'si') return 'sospetto';
    return sospetto(titolo, k) ? 'sospetto' : null;
  };
  f.modo = m;
  return f;
}

// ── Il box ──

// Il box sta nella finestra della scheda: un titolo dell'incognito non compare in quella normale, e una domanda
// risolta non resta aperta in un'altra finestra. Senza la finestra, almeno lo stesso lato (incognito o no).
function finestre(a) {
  try {
    const { BrowserWindow } = require('electron');
    return BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed?.() && w._filoTabs
      && w.webContents && !w.webContents.isDestroyed?.() && !w.webContents.isLoading?.()
      && (a.finestra != null ? w.id === a.finestra : !!w._filoTabs.incognito === !!a.incognito));
  } catch (_) { return []; }
}

function manda(a, testo, azioni) {
  const { id } = a;
  if (posaPerProve) return posaPerProve({ id, testo, azioni });
  const opts = { durationSec: 0, unica: `titolo-scheda:${id}`, actions: azioni };
  let dette = 0;
  for (const w of finestre(a)) {
    try { w.webContents.send('shell:toast', { text: testo, opts }); dette++; } catch (_) {}
  }
  return dette > 0;
}

// Il titolo si mostra per quello che è, ma un mega di titolo non sta in un box: il resto lo dice l'ellissi.
function mostrato(titolo) {
  const t = String(titolo || '').replace(/\s+/g, ' ').trim();
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

function testoDomanda(a) {
  const dove = a.sito ? `su ${a.sito}` : 'aperta';
  return `Il titolo di una scheda ${dove} sembra rivolto a Filo: «${mostrato(a.titolo)}». È un tentativo di dargli ordini?`;
}
const TESTO_CONDIVIDI = 'Ci mandi questo titolo, il nome del sito e la tua risposta? Ci aiuta a migliorare il filtro.';

function apri(a) {
  const ok = manda(a, testoDomanda(a), [
    { label: 'Sì', titoloScheda: { id: a.id, passo: 'risposta', valore: 'si' } },
    { label: 'No', titoloScheda: { id: a.id, passo: 'risposta', valore: 'no' } },
  ]);
  // Nessuna cornice pronta (Filo che si apre): si riprova al prossimo cambio di titolo.
  if (!ok) { chiesti.delete(a.voce); inAttesa.delete(a.id); }
  return ok;
}

// Una domanda rimasta nella finestra chiusa non zittisce il suo sito altrove: si richiede alla prossima occasione.
function lasciaSenzaFinestra() {
  let BW = null;
  try { BW = require('electron').BrowserWindow; } catch (_) { return; }
  if (!BW || typeof BW.fromId !== 'function') return;
  for (const a of [...inAttesa.values()]) {
    if (a.finestra == null || a.risposta) continue;
    const w = BW.fromId(a.finestra);
    if (w && !w.isDestroyed?.()) continue;
    inAttesa.delete(a.id);
    chiesti.delete(a.voce);
  }
}

// A ogni cambio di titolo: se il titolo è sospetto e nessuno ha ancora risposto, il box si apre subito.
async function titoloCambiato({ titolo, url, incognito = false, finestra = null } = {}, settingsIn = null) {
  if (typeof titolo !== 'string' || !titolo.trim()) return false;
  const settings = await impostazioni(settingsIn);
  if (modo(settings) !== 'controlla') return false;
  // Una pagina delicata manda solo il nome del sito comunque: il suo titolo non entra, e non c'è niente da chiedere.
  try {
    if (globalThis.SN_DELICATE) {
      const d = await globalThis.SN_DELICATE.filtro(settings);
      if (d(url)) return false;
    }
  } catch (_) {}
  await carica();
  lasciaSenzaFinestra();
  const k = voce(titolo, url);
  if (risposta(k) || chiesti.has(k) || chiusi.has(k)) return false;
  // Un sito che cambia titolo di continuo non impila box: finché il suo non ha risposta (o è stato chiuso), i titoli
  // nuovi restano fuori senza chiedere.
  const sito = T().sito(url);
  if ([...inAttesa.values()].some((x) => x.sito === sito && !x.risposta)) return false;
  const regola = Defaults.regolaTitoli() || T().REGOLA;
  const esito = T().controlla(titolo, regola);
  if (!esito.sospetto) return false;
  chiesti.add(k);
  const a = { id: randomUUID(), voce: k, titolo: titolo.slice(0, 2000), url, sito, incognito: !!incognito, finestra: Number.isInteger(finestra) ? finestra : null, versione: esito.versione, risposta: '' };
  inAttesa.set(a.id, a);
  return apri(a);
}

async function registraRisposta(a, valore) {
  a.risposta = valore;
  const v = { r: valore, titolo: a.titolo, sito: a.sito };
  if (a.incognito) { risposteEffimere.delete(a.voce); risposteEffimere.set(a.voce, v); return; }
  await carica();
  risposte.delete(a.voce);
  risposte.set(a.voce, v);
  await salva();
}

// Le risposte arrivano solo dalla cornice della finestra (`isShell`): una pagina non può approvare il proprio titolo.
// Ritorna il secondo passo, se c'è, o `{ chiudi: true }`.
async function rispondi({ id, passo, valore } = {}) {
  const a = inAttesa.get(String(id || ''));
  if (!a) return { ok: false, chiudi: true };
  // La carta è sparita senza risposta (la ×, la pila piena): il sito non resta zittito, e il titolo si richiede
  // alla prossima pagina caricata.
  if (passo === 'chiuso') {
    inAttesa.delete(a.id);
    if (!a.risposta) { chiesti.delete(a.voce); chiusi.add(a.voce); }
    return { ok: true, chiudi: true };
  }
  if (passo === 'risposta') {
    if (valore !== 'si' && valore !== 'no') return { ok: false };
    if (a.risposta) return { ok: true, chiudi: true };
    await registraRisposta(a, valore);
    const settings = await impostazioni();
    const funzione = Defaults.canaleTitoli();
    if (!funzione || a.incognito || !condivisioneChiesta(settings)) { inAttesa.delete(a.id); return { ok: true, chiudi: true }; }
    return {
      ok: true,
      passo: {
        testo: TESTO_CONDIVIDI,
        azioni: [
          { label: 'Sì', titoloScheda: { id: a.id, passo: 'condividi', valore: 'si' } },
          { label: 'No', titoloScheda: { id: a.id, passo: 'condividi', valore: 'no' } },
          { label: 'Non chiedermelo più', titoloScheda: { id: a.id, passo: 'condividi', valore: 'mai' } },
        ],
      },
    };
  }
  if (passo === 'condividi') {
    if (!a.risposta || !['si', 'no', 'mai'].includes(valore)) return { ok: false };
    inAttesa.delete(a.id);
    if (valore === 'mai') {
      try { await globalThis.SN_STORAGE.updateSettings({ titoliSchede: { chiediCondivisione: false } }); } catch (_) {}
      return { ok: true, chiudi: true };
    }
    if (valore === 'no') return { ok: true, chiudi: true };
    const dato = T().datoCondiviso({ titolo: a.titolo, url: a.url, risposta: a.risposta, versione: a.versione });
    try {
      await (inviaTitolo || invia)(dato);
      return { ok: true, chiudi: true };
    } catch (e) {
      console.warn('[Filo] titolo condiviso non inviato:', e?.message || e);
      return { ok: false, chiudi: true, frase: 'Non sono riuscito a mandare il titolo: il server non ha risposto.' };
    }
  }
  return { ok: false };
}

// Una pagina caricata di nuovo sul sito rimette in gioco i box chiusi senza risposta.
function paginaCaricata(url) {
  const s = T().sito(url);
  for (const k of chiusi) if (k.startsWith(`${s}\n`)) chiusi.delete(k);
}

async function invia(dato) {
  const funzione = Defaults.canaleTitoli();
  if (!funzione || !dato) throw new Error('canale assente');
  const identity = require('../auth/anon-auth');
  const idToken = await identity.getIdToken();
  if (!idToken) throw new Error('no_identity');
  const res = await fetch(`${FUNCTIONS_BASE}/${funzione}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: dato }),
  });
  if (!res.ok) throw new Error(`${funzione} ${res.status}`);
  return true;
}

// Per le prove: chi riceve i titoli condivisi al posto del server, chi posa il box al posto delle finestre, e lo
// stato di sessione da capo.
function _perProve({ invio = undefined, posa = undefined, azzera = false } = {}) {
  if (invio !== undefined) inviaTitolo = invio;
  if (posa !== undefined) posaPerProve = posa;
  if (azzera) { risposte = null; caricate = null; risposteEffimere.clear(); chiesti.clear(); chiusi.clear(); inAttesa.clear(); memo.clear(); }
}

module.exports = { FONTE, filtro, modo, titoloCambiato, rispondi, paginaCaricata, elenco, dimentica, voce, _perProve };
globalThis.SN_TITOLI_MAIN = module.exports;
