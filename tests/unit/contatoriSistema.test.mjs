// I contatori del sistema (#1466): avvio, processi morti, blocchi, eccezioni, memoria, chiamate sincrone, chiusura,
// disco, sessione e aggiornamenti. Una prova per misura: un messaggio, un percorso o una chiave dello storage passati
// a chi registra escono come «altro» o non escono; poi il servizio vero con disco, orologio e finestre finti. Le regole
// col motore vero: contatoriRegole.motore-vero.mjs.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const leggi = (...p) => fs.readFileSync(join(ROOT, ...p), 'utf8');

const SEGRETI = ['C:\\Users\\mario\\AppData\\Roaming\\Filo\\storage.json', '/home/mario/.config/Filo', 'settings.apiKeys',
  'Cannot read properties of undefined (reading \'mario\')', 'https://banca.example/conto', '<img src=x onerror=alert(1)>'];
const sis = (doc) => C.leggiSistema(doc.sistema);
const documento = (dati, chiave = '2026-10-23T10') => C.documento({ pseudonimo: 'a'.repeat(20), chiave, app: '0.2.249', os: 'win', dati });
function nonEsce(doc) {
  const testo = JSON.stringify(doc);
  for (const s of SEGRETI) assert.ok(!testo.includes(s), `«${s}» è uscito: ${testo}`);
  for (const parola of ['mario', 'banca', 'onerror', 'apiKeys', 'Roaming']) assert.ok(!testo.includes(parola), `«${parola}» è uscito`);
  const v = C.valida(doc);
  assert.equal(v.ok, true, v.motivo);
}

const cartelle = [];
afterEach(() => { for (const d of cartelle.splice(0)) togliCartella(d); });

// ── Una prova per misura, sulla forma condivisa ───────────────────────────

test('1. passi e tipo dell’avvio: solo i passi dell’elenco, in fasce; un nome o un tempo che non è un numero non escono', () => {
  const o = C.oraVuota();
  assert.equal(C.registraPassoAvvio(o, 'adblock', 420), true);
  assert.equal(C.registraPassoAvvio(o, 'permessi', 1800), true);
  for (const s of SEGRETI) assert.equal(C.registraPassoAvvio(o, s, 10), false);
  assert.equal(C.registraPassoAvvio(o, 'adblock', SEGRETI[0]), false);
  assert.equal(C.registraPassoAvvio(o, 'adblock', -3), false);
  assert.equal(C.registraTipoAvvio(o, 'dopo_aggiornamento'), true);
  assert.equal(C.registraTipoAvvio(o, SEGRETI[1]), false);
  const doc = documento(o);
  assert.equal(doc.sistema, 'avvioPasso.adblock.ms500|1;avvioPasso.permessi.s2|1;avvioTipo.dopo_aggiornamento|1');
  assert.deepEqual(sis(doc).avvioPasso, { adblock: { ms500: 1 }, permessi: { s2: 1 } });
  nonEsce(doc);
});

test('2. processi morti: il tipo di Electron va sull’elenco, il resto è «altro»; un’uscita pulita non si conta', () => {
  const o = C.oraVuota();
  C.registraProcessoMorto(o, 'GPU', 'crashed');
  C.registraProcessoMorto(o, 'Sandbox helper', 'oom');
  C.registraProcessoMorto(o, 'scheda_in_recupero', 'crashed');
  C.registraProcessoMorto(o, SEGRETI[0], SEGRETI[3]);
  C.registraProcessoMorto(o, { toString() { return 'GPU'; } }, 'killed');
  assert.equal(C.registraProcessoMorto(o, 'GPU', 'clean-exit'), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).processoMorto, { gpu: { crashed: 1 }, sandbox_helper: { oom: 1 }, scheda_in_recupero: { crashed: 1 }, altro: { killed: 1, altro: 1 } });
  nonEsce(doc);
});

test('3. finestra bloccata: quante volte, e quanto fino a quando torna o la si chiude, in fasce', () => {
  const o = C.oraVuota();
  C.registraFinestraBloccata(o, 'volte');
  C.registraFinestraBloccata(o, 'volte');
  C.registraFinestraBloccata(o, 'tornata', 3500);
  C.registraFinestraBloccata(o, 'chiusa_da_utente', 40000);
  assert.equal(C.registraFinestraBloccata(o, SEGRETI[4], 10), false);
  assert.equal(C.registraFinestraBloccata(o, 'tornata', SEGRETI[3]), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).finestraBloccata, { volte: 2, tornata: { s5: 1 }, chiusa_da_utente: { oltre: 1 } });
  nonEsce(doc);
  assert.equal(documento(C.oraVuota()).sistema, '', 'un’ora senza niente lascia il sistema vuoto');
});

test('4. ciclo del main fermo: la fascia del ritardo più lungo dell’ora e i blocchi sopra 200 ms, 1 s e 5 s', () => {
  const o = C.oraVuota();
  for (const ms of [12, 250, 1200, 6000, 80]) C.registraMainFermo(o, ms);
  assert.equal(C.registraMainFermo(o, SEGRETI[2]), false);
  assert.equal(C.registraMainFermo(o, NaN), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).mainFermo, { max: { s10: 1 }, blocchi: { ms200: 3, ms1000: 2, ms5000: 1 } });
  nonEsce(doc);
  // Due ore di campioni unite: si sommano i blocchi, il massimo resta il più lungo.
  const a = C.oraVuota(); C.registraMainFermo(a, 300);
  const b = C.oraVuota(); C.registraMainFermo(b, 1100);
  C.unisciSistema(a, b);
  assert.deepEqual(sis(documento(a)).mainFermo, { max: { s2: 1 }, blocchi: { ms200: 2, ms1000: 1 } });
});

test('5. eccezioni del main: il nome della classe se è di serie, «altro» per il resto; mai messaggio né stack', () => {
  const o = C.oraVuota();
  C.registraEccezione(o, 'uncaught', new TypeError(SEGRETI[3]));
  C.registraEccezione(o, 'uncaught', Object.assign(new Error(SEGRETI[0]), { name: SEGRETI[1] }));
  C.registraEccezione(o, 'rejection', SEGRETI[4]);
  C.registraEccezione(o, 'rejection', null);
  C.registraEccezione(o, 'rejection', { get name() { throw new Error('getter'); } });
  assert.equal(C.registraEccezione(o, SEGRETI[2], new Error('x')), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).eccezioneMain, { uncaught: { TypeError: 1, altro: 1 }, rejection: { altro: 3 } });
  nonEsce(doc);
});

test('6. memoria: il totale dei processi in fasce di MB, schede vive e in attesa in fasce; lo zero ha la sua', () => {
  const o = C.oraVuota();
  assert.equal(C.registraMemoria(o, { mb: 700, vive: 6, attesa: 0 }), true);
  assert.equal(C.registraMemoria(o, { mb: SEGRETI[0], vive: 1, attesa: 1 }), false);
  assert.equal(C.registraMemoria(o, { mb: 100, vive: -1, attesa: 1 }), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).memoria, { totale: { mb1024: 1 }, vive: { n20: 1 }, attesa: { n0: 1 } });
  nonEsce(doc);
});

test('7. chiamate sincrone: solo i quattro canali, il tempo in fasce', () => {
  const o = C.oraVuota();
  for (const c of C.CANALI_SINCRONI) C.registraIpcSincrono(o, c, 3);
  C.registraIpcSincrono(o, 'adblock-css', 2500);
  assert.equal(C.registraIpcSincrono(o, 'filo:fp-config', 3), false, 'il canale col prefisso non è nell’elenco');
  assert.equal(C.registraIpcSincrono(o, SEGRETI[4], 3), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).ipcSincrono['adblock-css'], { ms500: 1, s5: 1 });
  assert.deepEqual(Object.keys(sis(doc).ipcSincrono), [...C.CANALI_SINCRONI]);
  nonEsce(doc);
});

test('8. chiusura e uscita precedente: durata in fasce, tetto dei cookie, pulita o no', () => {
  const o = C.oraVuota();
  C.registraChiusura(o, { ms: 2600, tetto: true });
  C.registraChiusura(o, { ms: 300 });
  assert.equal(C.registraChiusura(o, { ms: SEGRETI[0], tetto: true }), false);
  assert.equal(C.registraChiusura(o, { ms: null }), false);
  C.registraUscita(o, 'non_pulita');
  assert.equal(C.registraUscita(o, SEGRETI[1]), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).chiusura, { durata: { ms500: 1, s5: 1 }, tetto: 1 });
  assert.deepEqual(sis(doc).uscitaPrecedente, { non_pulita: 1 });
  nonEsce(doc);
});

test('9. storage.json: esiti della lettura, codici del salvataggio, rinomine, chiavi e cifratura solo come conti', () => {
  const o = C.oraVuota();
  const err = (code) => Object.assign(new Error(`${code}: ${SEGRETI[0]}`), { code, path: SEGRETI[0] });
  for (const ev of [C.eventoLettura('rovinato_con_copia'), C.eventoSalvataggio(err('ENOSPC')), C.eventoSalvataggio(err('EIO')),
    C.eventoSalvataggio(SEGRETI[3]), C.eventoRinomina(err('EBUSY')), 'salvataggio_tornato', 'chiave_non_serializzabile',
    'cambiato_senza_set', 'cifratura_assente', C.eventoDimensione(12 * 1024 * 1024), C.eventoFlush(700)]) {
    assert.equal(C.registraStorage(o, ev), true, ev);
  }
  assert.equal(C.eventoRinomina(err('ENOENT')), '', 'una rinomina che non si riprova non si conta');
  assert.equal(C.eventoLettura(SEGRETI[0]), '');
  for (const s of SEGRETI) assert.equal(C.registraStorage(o, s), false, `«${s}» non è un evento`);
  const doc = documento(o);
  assert.deepEqual(sis(doc).storageEsito, {
    lettura_rovinato_con_copia: 1, salvataggio_fallito_enospc: 1, salvataggio_fallito_altro: 2, salvataggio_tornato: 1,
    rinomina_ritentata_ebusy: 1, chiave_non_serializzabile: 1, cambiato_senza_set: 1, cifratura_assente: 1,
    dimensione_mb20: 1, flush_s1: 1,
  });
  nonEsce(doc);
});

test('10. sessione: schede in fasce, esito, e i tempi solo per quella ripristinata e mai oltre il suo conto', () => {
  const o = C.oraVuota();
  C.registraSessione(o, { esito: 'ripristinata', schede: 12, vistaMs: 900, codaMs: 7000 });
  C.registraSessione(o, { esito: 'lettura_fallita', vistaMs: 5 });
  assert.equal(C.registraSessione(o, { esito: SEGRETI[2] }), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).sessione, { schede: { n0: 1, n20: 1 }, esiti: { ripristinata: 1, lettura_fallita: 1 }, vista: { s1: 1 }, coda: { s10: 1 } });
  nonEsce(doc);
  // Uno stato su disco manomesso con più attese che sessioni esce col tetto, e il documento resta valido.
  const m = C.oraVuota(); m.sessione = { esiti: { ripristinata: 1 }, schede: { n1: 1 }, vista: { ms500: 50 } };
  assert.equal(C.valida(documento(m)).ok, true);
});

test('11. aggiornamenti: un nome dell’elenco per passo; la versione e il resto non escono', () => {
  const o = C.oraVuota();
  for (const e of ['trovato', 'scaricato', 'versione_rifiutata', 'bloccato_linux']) C.registraAggiornamento(o, e);
  assert.equal(C.registraAggiornamento(o, '0.2.250'), false);
  assert.equal(C.registraAggiornamento(o, SEGRETI[0]), false);
  const doc = documento(o);
  assert.deepEqual(sis(doc).aggiornamento, { trovato: 1, scaricato: 1, versione_rifiutata: 1, bloccato_linux: 1 });
  assert.ok(!doc.sistema.includes('0.2.250'));
  nonEsce(doc);
});

test('uno stato su disco con chiavi e valori inventati non arriva al documento', () => {
  const o = C.oraVuota();
  o.avvioPasso = { [SEGRETI[0]]: { ms500: 3 }, adblock: { [SEGRETI[1]]: 2, ms500: 1 } };
  o.processoMorto = { gpu: { [SEGRETI[3]]: 5 } };
  o.storageEsito = { [SEGRETI[2]]: 7 };
  o.memoria = { totale: { mb256: 'mario' } };
  o.mainFermo = { maxMs: SEGRETI[2], blocchi: { ms200: 1, ms1000: 4 } };
  const doc = documento(o);
  const S = sis(doc);
  assert.deepEqual(S.avvioPasso, { adblock: { ms500: 1 } });
  assert.deepEqual(S.processoMorto, {});
  assert.deepEqual(S.storageEsito, {});
  assert.deepEqual(S.memoria, {});
  assert.deepEqual(S.mainFermo, { blocchi: { ms200: 1, ms1000: 1 } }, 'i blocchi restano in ordine anche da un disco storto');
  nonEsce(doc);
});

// ── Il servizio ───────────────────────────────────────────────────────────

const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const ORA = 60 * 60 * 1000;
const T0 = new Date(2026, 9, 23, 10, 5, 0).getTime();
const attendi = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function banco({ dir = null, versione = '0.2.249', accesi = true } = {}) {
  const cartella = dir || cartellaTemporanea('filo-contatori-sistema-');
  if (!dir) cartelle.push(cartella);
  const disco = new Map();
  const b = {
    t: T0, accesi, finestra: true, soloIncognito: false, inviati: [], scritture: 0, n: 0, cartella,
    disco: {}, dimensione: null, metriche: null, schede: { vive: 0, attesa: 0 }, versione,
  };
  b.s = Servizio.crea({
    contatori: C,
    storage: {
      getRaw: async (k, d) => (disco.has(k) ? JSON.parse(JSON.stringify(disco.get(k))) : d),
      setRaw: async (k, v) => { b.scritture += 1; disco.set(k, JSON.parse(JSON.stringify(v))); },
    },
    impostazioni: async () => ({ contatori: { attivi: b.accesi } }),
    inIncognito: () => false,
    runNormale: (fn) => fn(),
    finestraNormale: () => b.finestra,
    soloIncognito: () => b.soloIncognito,
    adesso: () => b.t,
    versione: () => b.versione,
    piattaforma: 'win32',
    esclusi: async () => [],
    casuale: () => `${'7'.repeat(18)}${String(++b.n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    fetch: async (url, opt) => {
      const fields = JSON.parse(opt.body).fields;
      const daFs = (v) => ('stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue)
        : 'arrayValue' in v ? (v.arrayValue.values || []).map(daFs) : Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)])));
      b.inviati.push(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, daFs(v)])));
      return { ok: true, status: 200, json: async () => ({}) };
    },
    log: () => {},
    cartella: () => cartella,
    contiDisco: () => { const d = b.disco; b.disco = {}; return d; },
    dimensioneDisco: () => b.dimensione,
    metriche: () => b.metriche,
    schede: () => b.schede,
    electron: {},
  });
  b.ora = async () => {
    b.t += ORA;
    await b.s.controlla();
    return b.inviati[b.inviati.length - 1];
  };
  b.segno = () => { try { return JSON.parse(fs.readFileSync(join(cartella, Servizio.FILE_SEGNO), 'utf8')); } catch (_) { return null; } };
  return b;
}

test('il segno dell’uscita: una chiusa a metà è non pulita; una chiusa bene porta la durata e il tetto dei cookie', async () => {
  const a = banco();
  assert.equal(await a.s.avvioProcesso(), true);
  assert.deepEqual(a.segno(), { stato: 'aperta', versione: '0.2.249' });
  await a.s.controlla();
  let doc = await a.ora();
  assert.deepEqual(sis(doc).avvioTipo, { freddo: 1 });
  assert.deepEqual(sis(doc).uscitaPrecedente, {}, 'la prima volta non c’è una volta prima');

  // Filo è caduto: il segno è rimasto «aperta».
  const b = banco({ dir: a.cartella });
  await b.s.avvioProcesso();
  await b.s.controlla();
  doc = await b.ora();
  assert.deepEqual(sis(doc).uscitaPrecedente, { non_pulita: 1 });
  assert.deepEqual(sis(doc).chiusura, {});

  // Questa volta si chiude: tre secondi dal primo «esci», col tetto dei cookie scattato.
  b.s.inizioChiusura();
  b.t += 1000;
  b.s.inizioChiusura();
  b.s.tettoChiusura();
  b.t += 2000;
  assert.equal(b.s.fineChiusura(), true);
  assert.deepEqual(b.segno(), { stato: 'chiusa', versione: '0.2.249', ms: 3000, tetto: true });

  // L'avvio dopo, con una versione nuova.
  const c = banco({ dir: a.cartella, versione: '0.2.250' });
  await c.s.avvioProcesso();
  await c.s.controlla();
  doc = await c.ora();
  assert.deepEqual(sis(doc).avvioTipo, { dopo_aggiornamento: 1 });
  assert.deepEqual(sis(doc).uscitaPrecedente, { pulita: 1 });
  assert.deepEqual(sis(doc).chiusura, { durata: { s5: 1 }, tetto: 1 });
  assert.equal(C.valida(doc).ok, true);

  // Chiuso dal sistema (spegnimento): pulita, senza una durata.
  c.s.fineChiusura({ sistema: true });
  assert.equal(c.segno().ms, null);
  const d = banco({ dir: a.cartella, versione: '0.2.250' });
  await d.s.avvioProcesso();
  await d.s.controlla();
  doc = await d.ora();
  assert.deepEqual(sis(doc).uscitaPrecedente, { pulita: 1 });
  assert.deepEqual(sis(doc).chiusura, {});
});

test('spenti: niente segno, niente conti del sistema, e lo spegnimento a metà toglie il segno', async () => {
  const a = banco({ accesi: false });
  fs.writeFileSync(join(a.cartella, Servizio.FILE_SEGNO), JSON.stringify({ stato: 'aperta', versione: '0.2.248' }));
  assert.equal(await a.s.avvioProcesso(), false);
  assert.equal(a.segno(), null, 'spenti, il segno di prima se ne va');
  a.s.ipcSincrono('fp-config', 5);
  a.s.passoAvvio('adblock', 100);
  a.t += 2 * ORA;
  await a.s.controlla();
  assert.equal(a.inviati.length, 0);
  assert.equal(a.s.fineChiusura(), false);
  assert.equal(a.segno(), null);

  const b = banco();
  await b.s.avvioProcesso();
  assert.ok(b.segno());
  b.s.passoAvvio('adblock', 100);
  b.s.seguiImpostazioni({ contatori: { attivi: false } });
  await attendi();
  assert.equal(b.segno(), null);
  assert.equal(b.s.processoMorto('GPU', 'crashed'), false, 'da spenti non si raccoglie niente');
  assert.equal(b.s.fineChiusura(), false);
  b.accesi = false;
  b.t += 2 * ORA;
  await b.s.controlla();
  assert.equal(b.inviati.length, 0, 'quello raccolto prima dello spegnimento non parte');
});

test('le misure frequenti aspettano una scrittura che c’è comunque: centinaia di chiamate sincrone, nessun salvataggio', async () => {
  const b = banco();
  await b.s.accesi();
  for (let i = 0; i < 300; i++) b.s.ipcSincrono('fp-config', 2);
  b.s.ipcSincrono('cookie-wipe', 900);
  b.s.ipcSincrono('adblock-css', 4, { incognito: true });
  await attendi();
  assert.equal(b.scritture, 0, 'nessuna scrittura per una chiamata sincrona');
  b.disco = { lettura_ok: 1, flush_ms500: 4, 'settings.apiKeys': 9 };
  b.metriche = [{ memory: { workingSetSize: 300 * 1024 } }, { memory: { workingSetSize: 500 * 1024 } }];
  b.schede = { vive: 4, attesa: 9 };
  b.dimensione = 3 * 1024 * 1024;
  await b.s.controlla();
  const doc = await b.ora();
  const S = sis(doc);
  assert.deepEqual(S.ipcSincrono, { 'fp-config': { ms500: 300 }, 'cookie-wipe': { s1: 1 } });
  assert.deepEqual(S.storageEsito, { lettura_ok: 1, dimensione_mb5: 1, flush_ms500: 4 });
  assert.deepEqual(S.memoria, { totale: { mb1024: 1 }, vive: { n5: 1 }, attesa: { n20: 1 } });
  nonEsce(doc);
});

test('con sole finestre incognito l’ora non prende né campioni né quello che aspettava; un’eccezione lì non si conta', async () => {
  const b = banco();
  await b.s.accesi();
  b.metriche = [{ memory: { workingSetSize: 100 * 1024 } }];
  b.soloIncognito = true;
  assert.equal(b.s.eccezione('uncaught', new TypeError('x')), false);
  assert.equal(b.s.processoMorto('GPU', 'crashed'), false);
  b.soloIncognito = false;
  b.s.passoAvvio('adblock', 10);
  b.finestra = false;
  await b.s.controlla();
  b.finestra = true;
  b.t += 2 * ORA;
  await b.s.controlla();
  assert.equal(b.inviati.length, 0, 'niente era da mandare');
  // All'avvio non c'è ancora una finestra: un'eccezione lì si conta.
  assert.equal(b.s.eccezione('uncaught', new RangeError('y')), true);
});

test('la finestra principale bloccata: tornata o chiusa, con la durata; durante l’uscita non si conta', async () => {
  const b = banco();
  await b.s.accesi();
  const win = new EventEmitter();
  b.s.seguiFinestra(win);
  win.emit('unresponsive');
  win.emit('unresponsive');
  b.t += 3000;
  win.emit('responsive');
  win.emit('unresponsive');
  b.t += 45000;
  win.emit('close');
  win.emit('closed');
  b.s.inizioChiusura();
  win.emit('unresponsive');
  b.t += 1000;
  win.emit('responsive');
  await b.s.controlla();
  const doc = await b.ora();
  assert.deepEqual(sis(doc).finestraBloccata, { volte: 2, tornata: { s5: 1 }, chiusa_da_utente: { oltre: 1 } });
});

test('il ciclo del main: un campione al secondo dall’istogramma, senza la risoluzione; il sonno non è un blocco', async () => {
  const fermo = { max: 0, reset() { this.max = 0; }, enable() { this.acceso = true; }, disable() { this.acceso = false; } };
  const c = banco();
  const s = Servizio.crea({
    contatori: C,
    storage: { getRaw: async () => null, setRaw: async () => {} },
    impostazioni: async () => ({ contatori: { attivi: true } }),
    inIncognito: () => false, runNormale: (fn) => fn(), finestraNormale: () => true, soloIncognito: () => false,
    adesso: () => c.t, versione: () => '0.2.249', log: () => {}, cartella: () => c.cartella,
    contiDisco: () => ({}), dimensioneDisco: () => null, metriche: () => null, schede: () => ({ vive: 0, attesa: 0 }),
    istogramma: (o) => { assert.equal(o.resolution, 50); return fermo; }, electron: {},
  });
  await s.accesi();
  s.avviaFermo();
  assert.equal(fermo.acceso, true);
  fermo.max = (50 + 1500) * 1e6;
  s.leggiFermo();
  assert.equal(fermo.max, 0, 'ogni lettura riparte da zero');
  fermo.max = 55 * 1e6;
  s.leggiFermo();
  s.sonno();
  fermo.max = 3600 * 1000 * 1e6;
  s.leggiFermo();
  fermo.max = 3600 * 1000 * 1e6;
  s.leggiFermo();
  fermo.max = 0;
  s.leggiFermo();
  const ora = await s.letto().then(() => s.perLaChiusura());
  const dati = Object.values(ora)[0].ore;
  const doc = documento(Object.values(dati)[0]);
  assert.deepEqual(sis(doc).mainFermo, { max: { s2: 1 }, blocchi: { ms200: 1, ms1000: 1 } }, 'il blocco da un secondo e mezzo; le letture del sonno buttate');
  s.fermaFermo();
  assert.equal(fermo.acceso, false);
});

test('la sessione riaperta: si conta quando arrivano la scheda in vista e la coda, o dopo dieci minuti', async () => {
  const b = banco();
  await b.s.accesi();
  const m = b.s.sessione({ esito: 'ripristinata', schede: 8, t0: b.t });
  b.t += 1200;
  m.vista();
  m.vista();
  b.t += 6000;
  m.coda();
  b.s.sessione({ esito: 'niente' });
  b.s.sessione({ esito: SEGRETI[0] });
  await b.s.controlla();
  const doc = await b.ora();
  assert.deepEqual(sis(doc).sessione, { schede: { n0: 1, n20: 1 }, esiti: { ripristinata: 1, niente: 1 }, vista: { s2: 1 }, coda: { s10: 1 } });
  nonEsce(doc);
});

test('alla chiusura l’ora porta anche quello che aspettava; spenti o mai letti, niente', async () => {
  const b = banco();
  assert.deepEqual(b.s.perLaChiusura(), {}, 'lo stato non è ancora stato letto');
  await b.s.accesi();
  await b.s.letto();
  b.s.processoMorto('Utility', 'crashed');
  const fuori = b.s.perLaChiusura();
  const ore = Object.values(fuori[Servizio.CHIAVE].ore);
  assert.equal(ore.length, 1);
  assert.deepEqual(sis(documento(ore[0])).processoMorto, { utility: { crashed: 1 } });
  b.s.seguiImpostazioni({ contatori: { attivi: false } });
  assert.deepEqual(b.s.perLaChiusura(), {});
});

// ── Il disco vero: storage.js e scritturaAtomica.js contano gli esiti, mai le chiavi ─────────────────────────

const PERCORSO = join(ROOT, 'src', 'main', 'shim', 'storage.js');
const electronMock = { app: { getPath: () => process.env.FILO_USER_DATA, isReady: () => true }, safeStorage: { isEncryptionAvailable: () => false } };
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};
function avvio(file = {}) {
  const dir = cartellaTemporanea('filo-contatori-disco-');
  cartelle.push(dir);
  for (const [nome, testo] of Object.entries(file)) fs.writeFileSync(join(dir, nome), testo);
  process.env.FILO_USER_DATA = dir;
  delete require.cache[require.resolve(PERCORSO)];
  return require(PERCORSO);
}
const Disco = require(join(ROOT, 'src', 'main', 'services', 'scritturaAtomica.js'));

test('storage.json: la lettura dice il suo esito, ogni scrittura la sua durata e la grandezza del file', async () => {
  let S = avvio({ 'storage.json': JSON.stringify({ a: 1 }) });
  await S.get('a');
  assert.deepEqual(S.contiDisco(), { lettura_ok: 1 });
  assert.equal(S.dimensioneDisco(), JSON.stringify({ a: 1 }).length);
  await S.set({ 'settings.apiKeys': 'mario' });
  await S.whenSettled();
  const conti = S.contiDisco();
  assert.deepEqual(Object.keys(conti), ['flush_ms500']);
  assert.deepEqual(S.contiDisco(), {}, 'ritirati, si azzerano');

  S = avvio();
  await S.get('a');
  assert.deepEqual(S.contiDisco(), { lettura_vuoto: 1 });
  S = avvio({ 'storage.json': '{rotto', 'storage.json.bak': JSON.stringify({ a: 2 }) });
  await S.get('a');
  assert.deepEqual(S.contiDisco(), { lettura_rovinato_con_copia: 1 });
  S = avvio({ 'storage.json': '{rotto' });
  await S.get('a');
  assert.deepEqual(S.contiDisco(), { lettura_rovinato_senza_copia: 1 });
  await S.whenSettled();
});

test('storage.json: un salvataggio fallito per codice, il ritorno, la chiave che non si serializza, la rinomina riprovata', async () => {
  const S = avvio({ 'storage.json': JSON.stringify({ a: 1 }) });
  await S.get('a');
  S.contiDisco();
  const vera = Disco.scrivi;
  Disco.scrivi = async () => { throw Object.assign(new Error(`ENOSPC: ${SEGRETI[0]}`), { code: 'ENOSPC' }); };
  try {
    await S.set({ b: 2 });
    await S.flushNow();
  } finally { Disco.scrivi = vera; }
  await S.set({ c: 3 });
  await S.flushNow();
  await S.set({ [SEGRETI[2]]: { n: 1n } });
  await S.flushNow();
  const vero = fs.promises.rename;
  let volte = 0;
  fs.promises.rename = async (...a) => { if (volte++ === 0) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return vero(...a); };
  try {
    await S.set({ d: 4 });
    await S.flushNow();
  } finally { fs.promises.rename = vero; }
  const conti = S.contiDisco();
  for (const k of ['salvataggio_fallito_enospc', 'salvataggio_tornato', 'chiave_non_serializzabile', 'rinomina_ritentata_ebusy']) {
    assert.ok(conti[k] >= 1, `${k}: ${JSON.stringify(conti)}`);
  }
  for (const k of Object.keys(conti)) assert.ok(C.EVENTI_STORAGE.includes(k), `${k} non è nell’elenco`);
  assert.ok(!JSON.stringify(conti).includes('apiKeys'));
  await S.whenSettled();
});

// ── Gli agganci: ogni voce di ogni elenco ha chi la produce ─────────────────────────────────────────────────

test('ogni passo dell’avvio, ogni canale sincrono e ogni passo degli aggiornamenti ha il suo aggancio nel codice', () => {
  const main = leggi('src', 'main', 'main.js');
  const finestra = leggi('src', 'main', 'window.js');
  for (const p of C.PASSI_AVVIO) assert.ok(new RegExp(`passo(AvvioFino)?\\('${p}'`).test(main + finestra), `nessuno misura il passo «${p}»`);
  assert.match(main, /process\.on\('uncaughtExceptionMonitor'/, 'il monitor, non un gestore: un gestore toglierebbe l’avviso di Electron');
  assert.ok(!/process\.on\('uncaughtException'/.test(main));
  assert.match(main, /process\.on\('unhandledRejection'[\s\S]{0,120}console\.warn/, 'il rifiuto resta scritto come prima');
  assert.match(main, /secondaIstanza\(\)/);
  assert.match(main, /app\.on\('will-quit'[\s\S]{0,80}fineChiusura\(\)/);
  assert.match(main, /tettoChiusura\(\)/);
  assert.match(main, /perLaChiusura\(\)/);
  const ipc = leggi('src', 'main', 'ipc.js');
  for (const c of C.CANALI_SINCRONI) assert.ok(ipc.includes(`ipcMain.on('filo:${c}', cronometrata('${c}',`), `il canale ${c} non è cronometrato`);
  const updater = leggi('src', 'main', 'updater.js');
  for (const e of C.EVENTI_AGGIORNAMENTO) {
    const diretto = updater.includes(`contaAggiornamento('${e}'`);
    const perSistema = (e === 'bloccato_mac' || e === 'bloccato_linux') && updater.includes("'bloccato_mac' : 'bloccato_linux'");
    assert.ok(diretto || perSistema, `nessuno conta «${e}»`);
  }
  const storage = leggi('src', 'main', 'shim', 'storage.js');
  for (const e of C.ESITI_LETTURA.filter((x) => !['rovinato_con_copia', 'rovinato_senza_copia', 'non_spostato_sola_memoria'].includes(x))) {
    assert.ok(storage.includes(`contaDisco('lettura', '${e}')`), `nessuno conta la lettura «${e}»`);
  }
  for (const e of ['salvataggio_tornato', 'chiave_non_serializzabile', 'cambiato_senza_set', 'cifratura_assente']) {
    assert.ok(storage.includes(`contaDisco('${e}')`), `nessuno conta «${e}»`);
  }
  const tabs = leggi('src', 'main', 'tabs.js');
  assert.match(tabs, /processoMorto\('scheda_in_recupero'/);
  for (const e of C.ESITI_SESSIONE) assert.ok(tabs.includes(`'${e}'`), `la sessione «${e}» non si conta`);
  assert.match(leggi('src', 'main', 'services', 'handlers', 'contatori.js'), /processoMorto\(details\.type, details\.reason\)/);
  assert.match(finestra, /seguiFinestra\(win\)/);
});
