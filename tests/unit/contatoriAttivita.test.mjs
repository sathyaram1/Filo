// Le attività dei contatori (#1467): ogni misura diventa una combinazione di nomi da elenchi chiusi, coi numeri in
// fasce; quello che non sta negli elenchi non entra, e oltre il tetto di un'ora si somma in «altro». La spedizione e il
// servizio: contatoriInvio.test.mjs; le regole: firestoreRulesContatori.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'chatErrors', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const MIN = 60 * 1000;
const GIORNO = 24 * 60 * MIN;

const conta = (misura, x) => {
  const ora = C.oraVuota();
  return C.registraAttivita(ora, misura, x) ? Object.keys(ora[misura])[0] : '';
};

test('l’Aiuto: esito, passi da solo e cliccati, elementi non trovati e documenti, in fasce', () => {
  assert.equal(conta('aiuto', { esito: 'fatto', passiDaSolo: 0, passiCliccati: 1, nonTrovati: 0, documenti: 1 }), 'fatto|p0|p1|n0|n1');
  assert.equal(conta('aiuto', { esito: 'tetto_passi', passiDaSolo: 20, passiCliccati: 5, nonTrovati: 2, documenti: 7 }), 'tetto_passi|p6_20|p2_5|n2_oltre|n2_oltre');
  assert.equal(conta('aiuto', { esito: 'chiusa_prima', passiDaSolo: 21 }), 'chiusa_prima|oltre|p0|n0|n0', 'i numeri che mancano valgono zero');
  assert.equal(conta('aiuto', { esito: 'errore', passiDaSolo: -3 }), 'errore|p0|p0|n0|n0');
  assert.equal(conta('aiuto', { esito: 'fatto ma male' }), '');
  assert.equal(conta('aiuto', {}), '');
});

test('la ricerca web: da dove, chi ha risposto, il ripiego, i risultati; e l’Aiuto al tetto', () => {
  assert.deepEqual(C.esitoRicerca({ ok: true, provider: 'tavily', results: [1, 2] }), { fornitore: 'tavily', ripiego: false, risultati: 2 });
  assert.deepEqual(C.esitoRicerca({ ok: true, provider: 'duckduckgo', results: [], ripiego: true }), { fornitore: 'duckduckgo', ripiego: true, risultati: 0 });
  assert.deepEqual(C.esitoRicerca({ ok: false, results: [], reason: 'tutti i provider hanno fallito: x' }), { fornitore: 'nessuno', ripiego: false, risultati: 0 });
  assert.deepEqual(C.esitoRicerca({ ok: true, provider: 'bing', results: [1] }), { fornitore: 'nessuno', ripiego: false, risultati: 1 });
  assert.deepEqual(C.esitoRicerca(null), { fornitore: 'nessuno', ripiego: false, risultati: 0 });
  assert.equal(conta('ricercaWeb', { da: 'chat', ...C.esitoRicerca({ ok: true, provider: 'tavily', results: [1, 2, 3, 4, 5] }) }), 'chat|tavily|no|r3_5');
  assert.equal(conta('ricercaWeb', { da: 'aiuto', fornitore: 'duckduckgo', ripiego: true, risultati: 1 }), 'aiuto|duckduckgo|si|r1_2');
  assert.equal(conta('ricercaWeb', { da: 'aiuto', fornitore: 'nessuno', risultati: 9 }), 'aiuto|nessuno|no|oltre');
  assert.equal(conta('ricercaWeb', { alTetto: true }), 'aiuto|al_tetto');
  assert.equal(conta('ricercaWeb', { da: 'barra', fornitore: 'tavily' }), '');
});

test('la dettatura: il motivo della chiusura, le frasi in fasce, che fine ha fatto il testo, le provvisorie', () => {
  assert.equal(conta('dettatura', { motivo: 'finito', frasi: 1, invio: 'da_sola' }), 'finito|f1|da_sola|no');
  assert.equal(conta('dettatura', { motivo: 'utente', frasi: 4, invio: 'cambiata', provvisorie: true }), 'utente|f2_5|cambiata|si');
  assert.equal(conta('dettatura', { motivo: 'muto', frasi: 0, invio: 'nessuno' }), 'muto|f0|nessuno|no');
  assert.equal(conta('dettatura', { motivo: 'tempo', frasi: 30, invio: 'tenuta' }), 'tempo|oltre|tenuta|no');
  assert.equal(conta('dettatura', { motivo: 'finito', frasi: 1, invio: 'ciao a tutti' }), '');
  assert.equal(conta('dettatura', { motivo: 'boh', frasi: 1, invio: 'da_sola' }), '');
});

test('la lettura: la voce, perché il ripiego, fin dove', () => {
  assert.equal(C.motivoLettura({ ripiego: false, codice: 'NO_API_KEY' }), 'nessuno');
  assert.equal(C.motivoLettura({ ripiego: true, codice: 'NO_API_KEY' }), 'no_api_key');
  assert.equal(C.motivoLettura({ ripiego: true, codice: 'TTS_VOICE_UNKNOWN' }), 'tts_voice_unknown');
  assert.equal(C.motivoLettura({ ripiego: true, chiaveRifiutata: true }), 'chiave_rifiutata');
  assert.equal(C.motivoLettura({ ripiego: true, errore: 'no_tts_model' }), 'no_tts_model');
  assert.equal(C.motivoLettura({ ripiego: true, codice: 'Il modello non risponde' }), 'altro');
  assert.equal(C.finoLettura(0, false), 'q25');
  assert.equal(C.finoLettura(0.25, false), 'q25');
  assert.equal(C.finoLettura(0.5, false), 'q50');
  assert.equal(C.finoLettura(0.7, false), 'q75');
  assert.equal(C.finoLettura(0.99, false), 'q100');
  assert.equal(C.finoLettura(0.3, true), 'fine');
  assert.equal(C.finoLettura(null, false), '');
  assert.equal(conta('lettura', { voce: 'mista', motivo: 'no_api_key', fino: 'q50' }), 'mista|no_api_key|q50');
  assert.equal(conta('lettura', { voce: 'modello', motivo: 'nessuno', fino: '' }), '', 'senza sapere fin dove non entra');
});

test('lezioni e compattazione: niente da imparare, scritte e scartate, il riordino con le righe non rimesse', () => {
  assert.equal(conta('lezioni', { nulla: true }), 'nulla');
  assert.equal(conta('lezioni', { scritte: 1, scartate: 0 }), 'l1|l0');
  assert.equal(conta('lezioni', { scritte: 3, scartate: 2 }), 'l2_3|l2_3');
  assert.equal(conta('lezioni', { scritte: 4, scartate: 9 }), 'oltre|oltre');
  assert.equal(conta('compattazioni', { esito: 'applicata', nonRimesse: 0 }), 'applicata|r0');
  assert.equal(conta('compattazioni', { esito: 'rimandata', nonRimesse: 6 }), 'rimandata|oltre');
  assert.equal(conta('compattazioni', { esito: 'fatta' }), '');
});

test('la memoria corretta: da dove, cosa, che riga e da quanto c’era, mai il testo', () => {
  assert.equal(C.rigaMemoria({ modulo: 'PROFILO' }), 'profilo');
  assert.equal(C.rigaMemoria({ modulo: 'PREFERENZE' }), 'preferenze');
  assert.equal(C.rigaMemoria({ modulo: 'LAVORO' }), 'espansioni');
  assert.equal(C.rigaMemoria({ modulo: 'PROFILO', lezione: true }), 'lezione');
  assert.equal(conta('memoria', { via: 'quaderno', operazione: 'togli', riga: 'lezione', etaMs: 2 * 60 * MIN }), 'quaderno|togli|lezione|giorno');
  assert.equal(conta('memoria', { via: 'chat', operazione: 'correggi', riga: 'profilo', etaMs: 3 * GIORNO }), 'chat|correggi|profilo|settimana');
  assert.equal(conta('memoria', { via: 'quaderno', operazione: 'ripristina', riga: 'espansioni', etaMs: 20 * GIORNO }), 'quaderno|ripristina|espansioni|mese');
  assert.equal(conta('memoria', { via: 'chat', operazione: 'svuota', riga: 'tutte', etaMs: null }), 'chat|svuota|tutte|nd');
  assert.equal(conta('memoria', { via: 'quaderno', operazione: 'togli', riga: 'faccio il medico' }), '');
});

test('la pulizia delle schede e le schede riaperte: chi le aveva chiuse e da quanto', () => {
  assert.equal(conta('pulizia', { trigger: 'manual', candidate: 0, archiviate: 0, duplicati: 0, giudizioMancato: false }), 'manual|s0|s0|s0|no');
  assert.equal(conta('pulizia', { trigger: 'reopen', candidate: 30, archiviate: 6, duplicati: 2, giudizioMancato: true }), 'reopen|oltre|s6_20|s2_5|si');
  assert.equal(conta('pulizia', { trigger: 'boh' }), '');
  assert.equal(C.chiusaDa('manual'), 'persona');
  assert.equal(C.chiusaDa(''), 'persona');
  assert.equal(C.chiusaDa('duplicato'), 'duplicato');
  assert.equal(C.chiusaDa('pagina vecchia, non la usi da giorni'), 'pulizia', 'il perché scritto dal modello non esce, decide solo chi');
  assert.equal(conta('riaperte', { chiusaDa: 'pulizia', etaMs: 3 * MIN }), 'pulizia|min10');
  assert.equal(conta('riaperte', { chiusaDa: 'persona', etaMs: 30 * MIN }), 'persona|ora');
  assert.equal(conta('riaperte', { chiusaDa: 'duplicato', etaMs: 5 * GIORNO }), 'duplicato|oltre');
  assert.equal(conta('riaperte', { chiusaDa: 'pulizia', etaMs: null }), '');
});

test('la home e i suggerimenti: chi l’ha scritta, il posto, il tipo d’azione e l’età', () => {
  assert.equal(C.esitoHome('chiave'), 'senza_ai_chiave');
  assert.equal(C.esitoHome('pesi-aperti'), 'senza_ai_pesi_aperti');
  assert.equal(C.esitoHome('modelli'), 'senza_ai_modelli');
  assert.equal(C.esitoHome(''), '');
  assert.equal(conta('home', { esito: 'generata' }), 'generata');
  assert.equal(conta('suggerimenti', { tipo: 'naviga', posizione: 1, etaMs: 10 * MIN }), 'NAVIGA|1|ora');
  assert.equal(conta('suggerimenti', { tipo: 'CHAT', posizione: 7, etaMs: 2 * 60 * MIN }), 'CHAT|4_oltre|giorno');
  assert.equal(conta('suggerimenti', { tipo: 'https://mario.it', posizione: 2, etaMs: 3 * GIORNO }), 'altro|2|oltre', 'un tipo fuori dal registro è «altro»');
  assert.equal(conta('suggerimenti', { tipo: 'PULISCI_TAB', posizione: 3 }), 'PULISCI_TAB|3|nd');
  assert.equal(conta('suggerimenti', { tipo: 'NAVIGA', posizione: 0 }), '', 'senza posto non entra');
});

test('oltre cento combinazioni in un’ora la nuova va in «altro», e il conto non perde niente', () => {
  const ora = C.oraVuota();
  const tipi = C.tipiSuggerimento().filter((t) => t !== 'altro');
  let n = 0;
  for (const tipo of tipi) for (const posizione of [1, 2, 3]) { C.registraAttivita(ora, 'suggerimenti', { tipo, posizione, etaMs: 1 }); n++; }
  assert.ok(n > C.TETTO_VOCI_ATTIVITA);
  const chiavi = Object.keys(ora.suggerimenti);
  assert.equal(chiavi.filter((k) => k !== 'altro').length, C.TETTO_VOCI_ATTIVITA);
  assert.equal(Object.values(ora.suggerimenti).reduce((a, x) => a + x, 0), n);
  const doc = C.documentoAttivita({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.250', os: 'linux', dati: ora });
  assert.equal(C.validaAttivita(doc).ok, true, C.validaAttivita(doc).motivo);
  assert.equal(Object.values(doc.suggerimenti).reduce((a, x) => a + Number(x), 0), n);
});

test('un documento manomesso sul disco esce ripulito: chiavi fuori elenco e numeri strani restano a casa', () => {
  const ora = C.oraVuota();
  ora.aiuto = { 'fatto|p0|p0|n0|n0': 2, 'cerca il volo per Roma': 5, 'fatto|p0|p0|n0|n0|x': 1, 'errore|p1|p0|n0|n0': -1 };
  ora.home = { generata: 1.5, senza_ai_chiave: 1 };
  ora.memoria = 'faccio il medico';
  const doc = C.documentoAttivita({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.250', os: 'win', dati: ora });
  assert.deepEqual(doc.aiuto, { 'fatto|p0|p0|n0|n0': '2' });
  assert.deepEqual(doc.home, { senza_ai_chiave: '1' });
  assert.deepEqual(doc.memoria, {});
  assert.equal(C.validaAttivita(doc).ok, true);
  assert.equal(C.validaAttivita({ ...doc, nota: 'ciao' }).ok, false);
  assert.equal(C.validaAttivita({ ...doc, home: { generata: '1 volta' } }).ok, false);
  assert.equal(C.validaAttivita({ ...doc, home: { 'la mia home': '1' } }).ok, false);
});

// Gli elenchi chiusi dicono i nomi che il codice usa davvero: un motivo o un invio nuovo va aggiunto qui, o non si conta.
test('i motivi della dettatura, i suoi invii e i codici della lettura sono quelli del codice', () => {
  const ascolto = leggi('src', 'shared', 'ascolto.js');
  const voce = leggi('src', 'shared', 'voceChat.js');
  const tts = leggi('src', 'content', 'tts.js');
  const motivi = new Set([...`${ascolto}\n${voce}\n${tts}`.matchAll(/\.ferma\('([a-z_]+)'\)/g)].map((m) => m[1]));
  for (const m of motivi) assert.ok(C.MOTIVI_DETTATURA.includes(m), `ferma('${m}') non è in MOTIVI_DETTATURA`);
  for (const m of ['utente', 'finito', 'muto', 'tempo', 'errore', 'altro', 'annulla']) assert.ok(C.MOTIVI_DETTATURA.includes(m), m);
  const invii = [...`${voce}\n${tts}`.matchAll(/(?:esitoDellAttesa|annullaInvio|tieni|contaSessione\(esito,|contaFine\(esito,)\(?\s*'([a-z_]+)'|perche = '([a-z_]+)'|\? '([a-z_]+)' : '([a-z_]+)'/g)]
    .flatMap((m) => m.slice(1).filter(Boolean));
  assert.ok(invii.length >= 8, 'gli invii della dettatura si contano davvero');
  for (const i of invii.filter((x) => !['si', 'no'].includes(x))) assert.ok(C.INVII_DETTATURA.includes(i), `«${i}» non è in INVII_DETTATURA`);
  const scritti = globalThis.SN_CHAT_ERRORS.CODICI_GIA_SCRITTI.filter((c) => c !== 'FEEDBACK_READ_DENIED');
  for (const c of [...scritti, 'TTS_VOICE_REQUIRED', 'TTS_VOICE_UNKNOWN']) assert.ok(C.CODICI_LETTURA.includes(c), c);
  assert.match(tts, /'TTS_VOICE_REQUIRED', 'TTS_VOICE_UNKNOWN'/, 'la lettura spiega ancora le due voci');
});
