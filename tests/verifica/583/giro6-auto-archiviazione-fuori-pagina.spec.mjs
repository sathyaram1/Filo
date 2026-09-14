// Verifica #583, giro 6 — l'ultima porta della finestra: l'archiviazione
// automatica.
//
// I giri 3, 4 e 5 hanno trovato tre volte lo stesso danno: qualcuno chiedeva
// «i primi N per data d'invio» e poi trattava la risposta come se fosse tutto.
// La correzione del giro 5 ha fatto l'inventario e ha chiuso quattro porte —
// la bacheca, l'annuncio della ricompensa, la scrittura delle schede e il
// comando da terminale — facendole leggere TUTTE le schede pubbliche, pagina
// dopo pagina.
//
// Nello stesso inventario, scritto nel racconto del pattern che quella
// correzione ha depositato, c'è anche l'archiviazione automatica. Lì però è
// stata chiusa una metà sola. Il giro legge le schede intere (i voti, che
// stanno lì, adesso arrivano tutti), ma i FEEDBACK su cui decide continua a
// chiederli a finestra: i più recenti per data d'invio, cinquecento.
//
// Le segnalazioni più vecchie di quella finestra — cioè esattamente quelle che
// un giro di archiviazione dovrebbe prendere per prime — non vengono nemmeno
// guardate. Per chi usa Filo vuol dire che i fix più vecchi non escono mai
// dalla bacheca: restano lì fra i «Risolti», si continua a poterli votare e si
// continua a poter pagare per riaprirli, per sempre.
//
// COME È FATTA LA PROVA
// La sorgente finta si comporta come Firestore davvero: ordina per data
// d'invio decrescente, taglia a `pageSize`, e sa ripartire da un cursore
// (`afterName`) con la stessa convenzione che la correzione del giro 5 ha
// usato per le schede. Così la prova non impone una strada: diventa verde
// qualunque modo si scelga per far arrivare al giro anche le segnalazioni
// vecchie (paginare fino in fondo, chiedere le chiuse di recente, chiedere per
// id quelle che hanno una scheda).
//
// Quello che deve restare vero è una cosa sola: una segnalazione vecchia, già
// uscita in produzione e con i voti che dicono che il fix tiene, viene
// archiviata come una recente.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

const VERSIONE = '9.9.9';
const ADESSO = Date.parse('2026-09-14T12:00:00Z');
const GIORNO = 24 * 60 * 60 * 1000;

// Un feedback chiuso e uscito in produzione, con abbastanza voti «funziona»
// da superare la soglia di archiviazione.
function feedbackChiuso(id, seq, createdAt) {
  const votes = {};
  for (let i = 0; i < 5; i += 1) {
    votes[`utente-${i}`] = { vote: 'works', at: '2026-09-01T00:00:00.000Z' };
  }
  return {
    _id: id,
    name: `Segnalazione ${seq}`,
    seq,
    subSeq: 0,
    status: 'done',
    statusPublic: 'closed',
    resolvedInVersion: VERSIONE,
    createdAt,
    // chiusa da più di 24 ore: la soglia d'età è passata
    resolvedAt: new Date(ADESSO - 10 * GIORNO).toISOString(),
    votes,
  };
}

test('una segnalazione vecchia, fuori dalla pagina di caricamento, non viene mai archiviata', async () => {
  // ── Il database finto ────────────────────────────────────────────────────
  // 520 segnalazioni chiuse. Le prime 20 (per data) sono le VECCHIE: con un
  // tetto di 500 sui più recenti restano fuori.
  const tutti = [];
  for (let i = 0; i < 20; i += 1) {
    const giorno = new Date(Date.parse('2025-01-01T00:00:00Z') + i * GIORNO).toISOString();
    tutti.push(feedbackChiuso(`fb-vecchio-${i}`, i + 1, giorno));
  }
  for (let i = 0; i < 500; i += 1) {
    const giorno = new Date(Date.parse('2026-01-01T00:00:00Z') + i * GIORNO).toISOString();
    tutti.push(feedbackChiuso(`fb-recente-${i}`, 100 + i, giorno));
  }

  const IL_VECCHIO = 'fb-vecchio-0'; // la più vecchia di tutte

  // ── I moduli condivisi, come li carica lo script ─────────────────────────
  require(resolve(ROOT, 'src', 'shared', 'feedback.js'));
  require(resolve(ROOT, 'src', 'shared', 'manageReview.js'));
  require(resolve(ROOT, 'src', 'shared', 'boardArchive.js'));
  require(resolve(ROOT, 'src', 'shared', 'feedbackPublicView.js'));
  const FB = globalThis.SN_FEEDBACK;

  // ── La sorgente finta: si comporta come Firestore ────────────────────────
  // Ordinata per data d'invio decrescente, tagliata a `pageSize`, e con un
  // cursore per chi vuole arrivare in fondo.
  const perData = tutti.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const perNome = tutti.slice().sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const chiamate = [];

  FB.list = async ({ pageSize = 200, afterName = null } = {}) => {
    chiamate.push({ pageSize, afterName });
    if (typeof afterName === 'string') {
      // stessa convenzione delle schede: pagina per nome del documento
      const da = afterName ? perNome.findIndex((f) => afterName.endsWith(`/${f._id}`)) + 1 : 0;
      return perNome.slice(da, da + pageSize);
    }
    return perData.slice(0, pageSize);
  };
  // Se qualcuno aggiungesse una porta «tutti i feedback», passerebbe di qui.
  FB.listAll = async (opts = {}) => {
    const out = [];
    let cursor = '';
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const pagina = await FB.list({ pageSize: opts.pageSize || 500, afterName: cursor });
      out.push(...pagina);
      if (pagina.length < (opts.pageSize || 500)) break;
      cursor = `x/${pagina[pagina.length - 1]._id}`;
    }
    return out;
  };
  FB.listResolved = async ({ pageSize = 500 } = {}) => tutti
    .slice()
    .sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt)))
    .slice(0, pageSize);
  FB.getMany = async (ids) => tutti.filter((f) => ids.includes(f._id));

  // Le schede pubbliche: una per feedback chiuso, tutte, come dopo la
  // correzione del giro 5.
  const schede = tutti.map((f) => ({ _id: f._id, votes: f.votes }));
  FB.listAllPublic = async () => schede;
  FB.listPublic = async ({ pageSize = 500 } = {}) => schede.slice(0, pageSize);

  // ── Le credenziali: lo script ne chiede, ma non deve uscire in rete ──────
  const envSalvato = {
    sa: process.env.FILO_SA_KEY,
    gac: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    rt: process.env.FILO_ADMIN_REFRESH_TOKEN,
  };
  const fetchVero = globalThis.fetch;
  delete process.env.FILO_SA_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  process.env.FILO_ADMIN_REFRESH_TOKEN = 'finto-per-la-prova';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('securetoken')) {
      return { ok: true, status: 200, json: async () => ({ id_token: 'token-finto' }) };
    }
    throw new Error(`la prova non deve uscire in rete: ${u.slice(0, 120)}`);
  };

  let risultato;
  try {
    const { runAutoArchive } = await import(resolve(ROOT, 'scripts', 'auto-archive.mjs'));
    risultato = await runAutoArchive({ dryRun: true, now: ADESSO, releasedVersion: VERSIONE });
  } finally {
    globalThis.fetch = fetchVero;
    if (envSalvato.sa === undefined) delete process.env.FILO_SA_KEY;
    else process.env.FILO_SA_KEY = envSalvato.sa;
    if (envSalvato.gac === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = envSalvato.gac;
    if (envSalvato.rt === undefined) delete process.env.FILO_ADMIN_REFRESH_TOKEN;
    else process.env.FILO_ADMIN_REFRESH_TOKEN = envSalvato.rt;
  }

  const archiviati = risultato.toArchive.map((a) => a.id);

  // Controprova: una segnalazione RECENTE viene archiviata. Se questa fosse
  // rossa, il rosso parlerebbe di un'archiviazione rotta per tutti, non della
  // finestra.
  expect(archiviati).toContain('fb-recente-499');

  // Il caso vero: la più vecchia di tutte deve essere archiviata allo stesso
  // modo. Oggi non lo è, perché il giro non la guarda nemmeno.
  expect(
    archiviati,
    `la segnalazione più vecchia non è stata nemmeno guardata: `
    + `il giro ha chiesto ${JSON.stringify(chiamate)} e ha deciso su ${archiviati.length} segnalazioni`,
  ).toContain(IL_VECCHIO);
});
