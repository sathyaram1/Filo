// Le somme della scheda Contatori di Gestione (#1462): dai documenti di Firestore escono solo somme, una cella con meno
// di cinque copie esce senza numero (anche a cavallo di due mesi, quando lo pseudonimo cambia), e la lettura chiede solo
// i campi che somma, pagina dopo pagina. Il servizio vero: src/main/services/contatoriSomme.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'i18n', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const S = require(join(ROOT, 'src', 'main', 'services', 'contatoriSomme.js'));
const C = globalThis.SN_CONTATORI;
const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';

function valoreFs(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valoreFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valoreFs(x)])) } };
}

const pseudo = (i, mese = 'a') => `${mese}${String(i).padStart(19, '0')}`.slice(0, 20).replace(/[^0-9a-f]/g, 'b');

// Un'ora di una copia: `fai(ora)` la riempie con le funzioni di registrazione vere.
function documento(i, chiave, fai = () => {}, { app = '0.2.250', os = 'win', mese } = {}) {
  const ora = C.oraVuota();
  fai(ora);
  return C.documento({ pseudonimo: pseudo(i, mese), chiave, app, os, dati: ora });
}
const comeLetto = (doc) => S.documentoDa(Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, valoreFs(v)])), C);
const somma = (docs, o = {}) => S.somma(docs.map(comeLetto), { dal: '2026-10-14', al: '2026-10-20', ...o });
const riga = (blocco, id) => blocco.find((r) => r.id === id);

test('cinque copie si contano; quattro dicono «meno di 5», e lo zero lo dice uguale', () => {
  const docs = [];
  for (let i = 0; i < 5; i++) {
    docs.push(documento(i, '2026-10-15T09', (o) => {
      C.registraAzione(o, 'new-tab', { visto: 300, fine: 1500 });
      C.registraAzione(o, 'new-tab', { visto: 700, fine: 1500, ripetuta: true });
    }));
  }
  for (let i = 0; i < 4; i++) docs.push(documento(10 + i, '2026-10-16T10', (o) => C.registraAzione(o, 'reload', { visto: 100, fine: 100 })));
  const s = somma(docs);
  const nuova = riga(s.attese, 'a:new-tab');
  assert.deepEqual(nuova.principale, { n: 10, copie: 5 });
  assert.equal(nuova.etichetta, 'Apri una nuova scheda');
  assert.deepEqual(nuova.celle.visto.slice(0, 3), [{ n: 5, copie: 5 }, { n: 5, copie: 5 }, { sotto: true }]);
  assert.deepEqual(nuova.celle.fine[2], { n: 10, copie: 5 });
  assert.deepEqual(nuova.celle.rifatteQuota, { quota: 0.5 });
  assert.equal(nuova.periodi.length, 7);
  assert.deepEqual(nuova.periodi[1], { n: 10, copie: 5 });
  assert.deepEqual(nuova.periodi[0], { sotto: true });
  // Quattro copie: nessun numero, nemmeno l'andamento per giorno.
  const ricarica = riga(s.attese, 'a:reload');
  assert.deepEqual(ricarica.principale, { sotto: true });
  assert.equal(ricarica.periodi, undefined);
  // Mai usata: c'è, e non si distingue da quattro.
  assert.deepEqual(riga(s.attese, 'a:screenshot').principale, { sotto: true });
  assert.ok(riga(s.attese, 'f:explain'), 'anche le funzioni coi modelli hanno la loro riga');
  // Le copie attive per giorno: nove documenti, cinque copie il 15 e quattro il 16.
  assert.deepEqual(s.copie.periodi.slice(0, 3), [{ sotto: true }, { n: 5, copie: 5 }, { sotto: true }]);
  assert.deepEqual(s.copie.totale, { n: 9, copie: 9 });
  assert.deepEqual(s.copie.ore[9], { n: 5, copie: 5 });
  assert.deepEqual(s.copie.ore[10], { sotto: true });
  assert.deepEqual(s.copie.orePer['2026-10-15'][9], { n: 5, copie: 5 });
  // Prima le righe che si mostrano, poi le altre.
  assert.equal(s.attese[0].id, 'a:new-tab');
});

test('nessuno pseudonimo esce dalla somma, e nemmeno quanti documenti ci sono', () => {
  const docs = [];
  for (let i = 0; i < 6; i++) docs.push(documento(i, '2026-10-15T09', (o) => C.registraErroreVisto(o, 'crash:scheda:oom')));
  const s = somma(docs);
  const testo = JSON.stringify(s);
  for (let i = 0; i < 6; i++) assert.ok(!testo.includes(pseudo(i)), 'uno pseudonimo è uscito');
  assert.ok(!/[0-9a-f]{20}/.test(testo), 'niente che somigli a uno pseudonimo');
  assert.ok(!/"(documenti|letti|pseudonimo)"/.test(testo), 'niente conto dei documenti letti');
  assert.deepEqual(riga(s.erroriVisti, 'crash:scheda:oom').principale, { n: 6, copie: 6 });
  assert.equal(riga(s.erroriVisti, 'crash:scheda:oom').etichetta, 'Scheda caduta: memoria finita');
});

test('a cavallo di due mesi tre copie restano tre, anche con sei pseudonimi; cinque in un mese bastano', () => {
  const docs = [];
  for (let i = 0; i < 3; i++) {
    docs.push(documento(i, '2026-10-31T20', (o) => C.registraChiesto(o, 'explain'), { mese: 'a' }));
    docs.push(documento(i, '2026-11-01T09', (o) => C.registraChiesto(o, 'explain'), { mese: 'c' }));
  }
  let s = somma(docs, { dal: '2026-10-25', al: '2026-11-02' });
  assert.deepEqual(riga(s.chiedi, 'explain').principale, { sotto: true });
  assert.deepEqual(s.copie.totale, { sotto: true });
  for (let i = 3; i < 5; i++) docs.push(documento(i, '2026-10-30T20', (o) => C.registraChiesto(o, 'explain'), { mese: 'a' }));
  s = somma(docs, { dal: '2026-10-25', al: '2026-11-02' });
  // Cinque copie in ottobre: il numero si mostra; le copie contano una volta per mese, e lo si dice.
  assert.deepEqual(riga(s.chiedi, 'explain').principale, { n: 8, copie: 8 });
  assert.equal(s.copie.mesi, 2);
});

test('versione e sistema filtrano prima della somma; le versioni lette si offrono tutte', () => {
  const docs = [];
  for (let i = 0; i < 5; i++) docs.push(documento(i, '2026-10-15T09', (o) => C.registraChiesto(o, 'explain'), { app: '0.2.250', os: 'mac' }));
  for (let i = 5; i < 10; i++) docs.push(documento(i, '2026-10-15T09', (o) => C.registraChiesto(o, 'explain'), { app: '0.2.249', os: 'win' }));
  assert.deepEqual(riga(somma(docs).chiedi, 'explain').principale, { n: 10, copie: 10 });
  assert.deepEqual(riga(somma(docs, { os: 'mac' }).chiedi, 'explain').principale, { n: 5, copie: 5 });
  const s = somma(docs, { app: '0.2.249', os: 'mac' });
  assert.deepEqual(riga(s.chiedi, 'explain').principale, { sotto: true });
  assert.deepEqual(s.versioni, ['0.2.250', '0.2.249']);
  assert.deepEqual(s.sistemi, ['win', 'mac', 'linux', 'altro']);
});

test('una quota si mostra solo se si mostrano i due numeri da cui nasce', () => {
  const docs = [];
  for (let i = 0; i < 6; i++) {
    docs.push(documento(i, '2026-10-15T09', (o) => {
      C.registraProposta(o, 'ortografia', 'deepseek/deepseek-v4-flash', 'mostrata');
      if (i < 2) C.registraProposta(o, 'ortografia', 'deepseek/deepseek-v4-flash', 'accettata');
      else C.registraProposta(o, 'ortografia', 'deepseek/deepseek-v4-flash', 'ignorata');
      C.registraRicerca(o, 'tasto-destro', { esito: 'aperta' });
      C.registraRicerca(o, 'tasto-destro', { esito: 'scelta', attesaMs: 800, posizione: 2 });
      C.registraAnticipo(o, 'explain', 'preparato');
      if (i < 5) C.registraAnticipo(o, 'explain', 'aperto');
    }));
  }
  const s = somma(docs);
  const tipo = riga(s.correttore, 'ortografia');
  const modello = riga(s.correttore, 'ortografia|deepseek/deepseek-v4-flash');
  assert.equal(tipo.etichetta, 'Parola, tutti i modelli');
  assert.deepEqual(modello.celle.mostrate, { n: 6, copie: 6 });
  assert.deepEqual(modello.celle.accettate, { sotto: true });
  assert.deepEqual(modello.celle.accettateQuota, { sotto: true });
  assert.deepEqual(modello.celle.ignorate, { sotto: true });
  // Le righe del correttore stanno per tipo, il totale del tipo prima dei suoi modelli.
  assert.ok(s.correttore.indexOf(tipo) < s.correttore.indexOf(modello));
  const menu = riga(s.ricerche, 'tasto-destro');
  assert.deepEqual(menu.celle.aperte, { n: 6, copie: 6 });
  assert.deepEqual(menu.celle.vuoteQuota, { sotto: true });
  assert.deepEqual(menu.celle.posizioni[1], { n: 6, copie: 6 });
  const anticipo = riga(s.anticipi, 'explain');
  assert.deepEqual(anticipo.celle.preparati, { n: 6, copie: 6 });
  assert.deepEqual(anticipo.celle.aperti, { n: 5, copie: 5 });
  assert.deepEqual(anticipo.celle.maiVisti, { n: 1 });
  assert.deepEqual(anticipo.celle.maiVistiQuota, { quota: 1 / 6 });
});

test('impostazioni, conferme, intervista e prime volte contano le copie, nel verso in cui sono andate', () => {
  const docs = [];
  for (let i = 0; i < 7; i++) {
    docs.push(documento(i, '2026-10-15T09', (o) => {
      C.registraImpostazione(o, 'theme', i < 5 ? 'dark' : 'light', 'mano');
      C.registraImpostazione(o, 'theme', 'dark', 'chat');
      C.registraConferma(o, 'NAVIGA', { livello: 'default', stato: 'pulito', costo: '1', perimetro: 'dentro', origine: 'chat', risposta: 'si', esito: 'automatica' });
      C.registraAnnullato(o, 'NAVIGA');
      C.registraIntervista(o, 'profilo', 'spuntata');
      C.registraPrimaVolta(o, 'explain');
    }));
  }
  const s = somma(docs);
  const tema = riga(s.impostazioni, 'theme');
  assert.equal(tema.etichetta, 'Tema');
  assert.deepEqual(tema.principale, { n: 7, copie: 7 });
  assert.deepEqual(tema.celle.valori.map((v) => [v.etichetta, v.copie]), [['scuro', { n: 7, copie: 7 }], ['chiaro', { sotto: true }]]);
  assert.deepEqual(tema.celle.vie.mano, { n: 7, copie: 7 });
  assert.deepEqual(tema.celle.vie.import, { sotto: true });
  const naviga = riga(s.conferme, 'NAVIGA');
  assert.equal(naviga.etichetta, 'Naviga');
  assert.deepEqual(naviga.celle.automatica, { n: 7, copie: 7 });
  assert.deepEqual(naviga.celle.annullati, { n: 7, copie: 7 });
  assert.deepEqual(naviga.celle.rifiutata, { sotto: true });
  assert.ok(riga(s.conferme, 'correzione').celle.soloPagina);
  const passi = s.intervista.map((r) => r.id);
  assert.deepEqual(passi, C.passiIntervista(), 'i passi dell’intervista nell’ordine in cui si fanno');
  assert.deepEqual(riga(s.intervista, 'profilo').celle.scelte[0], { scelta: 'spuntata', copie: { n: 7, copie: 7 }, n: { n: 7, copie: 7 } });
  assert.deepEqual(riga(s.primeVolte, 'explain').principale, { n: 7, copie: 7 });
});

test('una finestra lunga passa alle settimane e poi ai mesi; la settimana porta il nome del lunedì', () => {
  assert.equal(S.passoPer(62), 'giorno');
  assert.equal(S.passoPer(63), 'settimana');
  assert.equal(S.passoPer(549), 'mese');
  assert.equal(S.periodoDi('2026-10-18', 'settimana'), '2026-10-12');
  assert.equal(S.periodoDi('2026-10-19', 'settimana'), '2026-10-19');
  const s = somma([], { dal: '2026-07-01', al: '2026-10-20' });
  assert.equal(s.passo, 'settimana');
  assert.equal(s.periodi[0].dal, '2026-07-01');
  assert.equal(s.periodi[0].chiave, '2026-06-29');
  assert.equal(s.periodi.at(-1).al, '2026-10-20');
});

function servizio(pagine, { stato = 200 } = {}) {
  const chieste = [];
  let t = 1_000_000;
  const s = S.crea({
    contatori: C,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    adesso: () => t,
    log: () => {},
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      chieste.push({ url, auth: init.headers.Authorization, q: body.structuredQuery });
      if (stato !== 200) return { ok: false, status: stato, json: async () => [{ error: { status: 'PERMISSION_DENIED' } }] };
      const i = body.structuredQuery.startAt ? 1 : 0;
      const righe = (pagine[i] || []).map((doc) => ({
        document: { name: `${BASE}/contatori-giornalieri/${C.idDocumento(doc)}`, fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, valoreFs(v)])) },
      }));
      return { ok: true, status: 200, json: async () => (righe.length ? righe : [{ readTime: 'x' }]) };
    },
  });
  return { s, chieste, avanti: (ms) => { t += ms; } };
}

test('la lettura chiede l’intervallo e i soli campi che somma, pagina dopo pagina, e la riusa per la stessa richiesta', async () => {
  const mille = Array.from({ length: 1000 }, (_, i) => documento(i % 6, `2026-10-15T${String(i % 24).padStart(2, '0')}`, (o) => C.registraChiesto(o, 'explain')));
  const { s, chieste, avanti } = servizio([mille, [documento(9, '2026-10-16T08')]]);
  const r = await s.somme({ idToken: 'tok', dal: '2026-10-14', al: '2026-10-20' });
  assert.equal(chieste.length, 2);
  assert.ok(chieste.every((c) => c.url === `${BASE}:runQuery?key=K` && c.auth === 'Bearer tok'));
  const q = chieste[0].q;
  assert.deepEqual(q.select.fields.map((f) => f.fieldPath), S.CAMPI_LETTI);
  assert.deepEqual(q.where.compositeFilter.filters.map((f) => [f.fieldFilter.op, f.fieldFilter.value.stringValue]),
    [['GREATER_THAN_OR_EQUAL', '2026-10-14'], ['LESS_THAN_OR_EQUAL', '2026-10-20']]);
  assert.equal(q.startAt, undefined);
  assert.deepEqual(chieste[1].q.startAt.values[0], { stringValue: '2026-10-15' });
  assert.match(chieste[1].q.startAt.values[1].referenceValue, /contatori-giornalieri\//);
  assert.deepEqual(riga(r.chiedi, 'explain').principale, { n: 1000, copie: 6 });
  assert.equal(r.completo, true);
  // Un filtro diverso sulla stessa finestra non rilegge; «Rileggi» sì, e dopo dieci minuti anche.
  await s.somme({ idToken: 'tok', dal: '2026-10-14', al: '2026-10-20', os: 'mac' });
  assert.equal(chieste.length, 2);
  await s.somme({ idToken: 'tok', dal: '2026-10-14', al: '2026-10-20', forza: true });
  assert.equal(chieste.length, 4);
  avanti(11 * 60 * 1000);
  await s.somme({ idToken: 'tok', dal: '2026-10-14', al: '2026-10-20' });
  assert.equal(chieste.length, 6);
});

test('la lettura negata o una richiesta storta dicono perché, e non restano in memoria', async () => {
  const { s, chieste } = servizio([], { stato: 403 });
  await assert.rejects(s.somme({ idToken: 'tok', dal: '2026-10-14', al: '2026-10-20' }), /contatori 403 PERMISSION_DENIED/);
  await assert.rejects(s.somme({ idToken: 'tok', dal: '2026-10-14', al: '2026-10-20' }), /contatori 403/);
  assert.equal(chieste.length, 2);
  await assert.rejects(s.somme({ idToken: 'tok', dal: '2026-10-20', al: '2026-10-14' }), /prima data viene dopo/);
  await assert.rejects(s.somme({ idToken: 'tok', dal: '2026-02-30', al: '2026-03-01' }), /servono due date/);
  await assert.rejects(s.somme({ idToken: 'tok', dal: '2020-01-01', al: '2026-10-14' }), /troppo lungo: \d+ giorni, al massimo 1100/);
  await assert.rejects(s.somme({ idToken: 'tok', dal: '2026-10-14', al: '2026-10-20', os: 'dos' }), /Sistema non valido/);
  await assert.rejects(s.somme({ idToken: 'tok', dal: '2026-10-14', al: '2026-10-20', app: '1.2' }), /Versione non valida/);
  await assert.rejects(s.somme({ dal: '2026-10-14', al: '2026-10-20' }), /Sessione scaduta/);
});

test('i riquadri delle installazioni attive seguono la stessa soglia', () => {
  assert.deepEqual(S.sottoSoglia({ giorno: '2026-10-15', n: 4, completo: true }), { giorno: '2026-10-15', n: null, completo: true, sotto: true });
  assert.deepEqual(S.sottoSoglia({ mese: '2026-10', n: 5, completo: true }), { mese: '2026-10', n: 5, completo: true });
  assert.equal(S.sottoSoglia(null), null);
});
