// La copia su file di una lettura già pagata: quando vale e quando no.
//
// Due usi, la stessa meccanica.
//   · La configurazione delle routine: lo stesso documento lo rileggevano
//     dispatch e verify-local a ogni invocazione, decine di volte per sessione.
//     Vale un minuto, non di più: una copia scaduta non deve far partire un giro
//     con un interruttore che l'owner ha appena spento.
//   · La prova a secco di uno script di manutenzione: l'applicazione che la
//     segue riusa quello che è già stato letto invece di riscansionare la
//     collezione (#680).
//
// Senza il fix questo file è rosso: la copia non esisteva.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const { leggiCopia, scriviCopia, scordaCopia, percorsoCopia, rigaCopiaRiusata } =
  await import('../../scripts/lib/copia-su-file.mjs');
const { campiDaCopia, salvaCampiInCopia, copiaAttiva, TTL_MS } =
  await import('../../scripts/lib/config-routine-copia.mjs');

const URL_VERO = 'https://firestore.example/config/routines?key=k';
const CAMPI = { enabled: { booleanValue: false }, cap3: { integerValue: '5' } };

test('la copia della configurazione: fresca risponde, scaduta no', () => {
  const dir = cartellaTemporanea('copia-config-');
  const t0 = 1_700_000_000_000;
  salvaCampiInCopia(URL_VERO, CAMPI, { now: t0, dir });

  const subito = campiDaCopia(URL_VERO, { now: t0 + 1_000, dir });
  assert.deepEqual(subito.fields, CAMPI, 'una copia di un secondo deve rispondere: è il caso che esiste per');
  assert.ok(subito.etaMs >= 1_000);

  assert.equal(campiDaCopia(URL_VERO, { now: t0 + TTL_MS - 1, dir }) !== null, true, 'entro il minuto vale');
  assert.equal(campiDaCopia(URL_VERO, { now: t0 + TTL_MS + 1, dir }), null,
    'oltre il minuto si rilegge: «spento» deve voler dire spento');
});

test('una copia illeggibile o di un altro documento non risponde: si rilegge dal server', () => {
  const dir = cartellaTemporanea('copia-rotta-');
  const t0 = 1_700_000_000_000;

  // Troncata a metà (il processo è morto mentre scriveva).
  salvaCampiInCopia(URL_VERO, CAMPI, { now: t0, dir });
  const file = percorsoCopia(`config-routines|pubblico|${URL_VERO}`, dir);
  const intero = readFileSync(file, 'utf8');
  writeFileSync(file, intero.slice(0, Math.floor(intero.length / 2)));
  assert.equal(campiDaCopia(URL_VERO, { now: t0 + 1_000, dir }), null, 'una copia troncata non deve valere');

  // JSON valido ma senza i campi.
  writeFileSync(file, JSON.stringify({ at: t0, chiave: `config-routines|pubblico|${URL_VERO}`, dati: { altro: 1 } }));
  assert.equal(campiDaCopia(URL_VERO, { now: t0 + 1_000, dir }), null);

  // Data nel futuro (orologio spostato): rileggere costa una lettura, fidarsi
  // di una data impossibile costa una decisione.
  salvaCampiInCopia(URL_VERO, CAMPI, { now: t0 + 60_000, dir });
  assert.equal(campiDaCopia(URL_VERO, { now: t0, dir }), null);

  // Assente del tutto.
  assert.equal(campiDaCopia('https://altro/doc', { now: t0, dir }), null);
});

test('chi legge col token dell\'owner e chi legge senza non condividono la copia', () => {
  const dir = cartellaTemporanea('copia-identita-');
  const t0 = 1_700_000_000_000;
  salvaCampiInCopia(URL_VERO, CAMPI, { now: t0, dir, conToken: false });
  assert.equal(campiDaCopia(URL_VERO, { now: t0, dir, conToken: true }), null,
    'le due identità possono vedere documenti diversi, e una copia non è il posto dove scoprirlo');
  assert.ok(campiDaCopia(URL_VERO, { now: t0, dir, conToken: false }));
});

test('col server finto dei controlli la copia è spenta: lì si controlla la lettura vera', () => {
  assert.equal(copiaAttiva({}), true);
  assert.equal(copiaAttiva({ FILO_ROUTINE_CONFIG_URL: 'http://127.0.0.1:9/x' }), false);
  assert.equal(copiaAttiva({ FILO_ROUTINE_CONFIG_URL: '   ' }), true);
});

test('la copia si scrive solo per chi la lancia (0600) e si può buttare', () => {
  const dir = cartellaTemporanea('copia-permessi-');
  const file = scriviCopia('prova', { a: 1 }, { dir });
  assert.ok(file);
  if (process.platform !== 'win32') {
    // La copia di una lettura dei feedback non deve essere leggibile dagli
    // altri utenti della macchina.
    assert.equal(statSync(file).mode & 0o077, 0);
  }
  assert.deepEqual(leggiCopia('prova', { dir }).dati, { a: 1 });
  assert.equal(scordaCopia('prova', { dir }), true);
  assert.equal(leggiCopia('prova', { dir }), null);
});

test('la frase a video dice che si sta riusando una lettura, e da quanto', () => {
  assert.match(rigaCopiaRiusata(42_000), /42 s/);
  assert.match(rigaCopiaRiusata(42_000), /nessuna richiesta al server/);
});

// ── La prova a secco e l'applicazione che la segue ──────────────────────────

test('l\'applicazione riusa la lettura della prova a secco, e dopo aver scritto la butta', async () => {
  const dir = cartellaTemporanea('copia-secco-');
  const t0 = 1_700_000_000_000;
  const { runAutoArchive } = await import('../../scripts/auto-archive.mjs');

  const FB = globalThis.SN_FEEDBACK;
  const letture = { segnalazioni: 0, schede: 0 };
  const vere = { list: FB.list, listPublic: FB.listPublic };
  FB.list = async () => { letture.segnalazioni += 1; return []; };
  FB.listPublic = async () => { letture.schede += 1; return []; };
  try {
    const secco = await runAutoArchive({ dryRun: true, now: t0, releasedVersion: '1.0.0', copiaDir: dir });
    assert.equal(letture.segnalazioni, 1, 'la prova a secco legge una volta');
    assert.match(secco.rigaLetture, /Documenti letti/);

    // L'applicazione che segue non ripaga la stessa scansione.
    await runAutoArchive({ dryRun: false, now: t0 + 30_000, releasedVersion: '1.0.0', copiaDir: dir });
    assert.equal(letture.segnalazioni, 1, 'l\'applicazione ha riletto quello che la prova a secco aveva già letto');

    // E dopo aver scritto la copia non descrive più il database.
    await runAutoArchive({ dryRun: false, now: t0 + 40_000, releasedVersion: '1.0.0', copiaDir: dir });
    assert.equal(letture.segnalazioni, 2, 'dopo un\'applicazione la copia deve essere buttata');
  } finally {
    FB.list = vere.list;
    FB.listPublic = vere.listPublic;
    FB.forgetAllPublic();
  }
});

test('una prova a secco non risponde con quello che ha letto un\'altra prova a secco', async () => {
  const dir = cartellaTemporanea('copia-secco-2-');
  const t0 = 1_700_000_000_000;
  const { runAutoArchive } = await import('../../scripts/auto-archive.mjs');
  const FB = globalThis.SN_FEEDBACK;
  let letti = 0;
  const vere = { list: FB.list, listPublic: FB.listPublic };
  FB.list = async () => { letti += 1; return []; };
  FB.listPublic = async () => [];
  try {
    await runAutoArchive({ dryRun: true, now: t0, releasedVersion: '1.0.0', copiaDir: dir });
    await runAutoArchive({ dryRun: true, now: t0 + 1_000, releasedVersion: '1.0.0', copiaDir: dir });
    assert.equal(letti, 2, 'una prova a secco deve guardare il database di adesso, non una copia');
  } finally {
    FB.list = vere.list;
    FB.listPublic = vere.listPublic;
    FB.forgetAllPublic();
  }
});
