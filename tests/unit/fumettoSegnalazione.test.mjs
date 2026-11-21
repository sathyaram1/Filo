// #1635, #1704.1 — ogni riga del diario di una segnalazione (conferma chiesta, inviata, non inviata) porta titolo e testo
// interi per il fumetto, anche nella chat riaperta; fumetto, riquadro di conferma e controllo delle uscite leggono gli
// stessi campi dell'invio. La prova nell'app: tests/home-fumetto-segnalazione.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['contenutoEsterno.js', 'nomiFile.js', 'timeFormat.js', 'feedback.js', 'allegatiSegnalazione.js', 'actionLevels.js',
  'sistema.js', 'esitoAzione.js', 'righeAttivita.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const RA = globalThis.SN_RIGHE_ATTIVITA;
const AS = globalThis.SN_ALLEGATI_SEGNALAZIONE;
const L = globalThis.SN_ACTION_LEVELS;
const ESITO = globalThis.SN_ESITO;

const TESTO = `Il timer non suona quando la scheda è dietro.\nSuccede sempre. ${'Dettaglio lungo. '.repeat(200)}fine.`;
const base = { type: 'INVIA_FEEDBACK', titolo: 'Timer muto', testo: TESTO };

test('le righe di una segnalazione portano titolo e testo interi, in ogni stato', () => {
  const atteso = `Timer muto\n\n${TESTO.trim()}`;
  const stati = {
    inviata: { ...base, _executed: true },
    'non inviata': { ...base, _executed: false, _output: { error: 'problema di rete' } },
    'conferma chiesta': { ...base, _confirm: { level: 2, text: 'Inviare questo feedback a nome tuo:\nTimer muto' } },
  };
  for (const [nome, a] of Object.entries(stati)) {
    const r = RA.riga(a);
    assert.ok(r, nome);
    assert.equal(r.title, atteso, nome);
  }
  assert.equal(RA.testoSegnalazione({ type: 'invia_feedback', title: ' T ', text: ' x ' }), 'T\n\nx');
  assert.equal(RA.testoSegnalazione({ type: 'INVIA_FEEDBACK' }), '');
});

test('le altre azioni non prendono il fumetto della segnalazione', () => {
  assert.equal(RA.testoSegnalazione({ type: 'TIMER', testo: 'x' }), '');
  assert.equal(RA.riga({ type: 'TIMER', secondi: 60, _executed: true }).title, undefined);
});

test('fumetto, riquadro di conferma, controllo delle uscite e riga dicono il titolo e il testo che partono (#1704.1)', () => {
  const ripiego = globalThis.SN_FEEDBACK.fallbackName('Il suono del timer non arriva mai quando la scheda è dietro');
  assert.ok(ripiego);
  const casi = [
    [{ titolo: 'Timer muto', testo: 'Non suona.' }, 'Timer muto', 'Non suona.'],
    // Il titolo sotto il terzo nome, quello che l'invio accettava e il fumetto no.
    [{ name: 'Timer muto', text: 'Non suona.' }, 'Timer muto', 'Non suona.'],
    // Un campo vuoto non nasconde quello scritto sotto l'altro nome.
    [{ titolo: '  ', title: 'Timer muto', testo: '', messaggio: 'Non suona.' }, 'Timer muto', 'Non suona.'],
    // Senza titolo parte quello di ripiego: si vede lui.
    [{ testo: 'Il suono del timer non arriva mai quando la scheda è dietro' }, ripiego, 'Il suono del timer non arriva mai quando la scheda è dietro'],
  ];
  for (const [campi, titolo, testo] of casi) {
    const a = { type: 'INVIA_FEEDBACK', ...campi };
    const nome = JSON.stringify(campi);
    assert.deepEqual(AS.campi(a), { titolo, testo }, nome);
    assert.equal(RA.testoSegnalazione(a), `${titolo}\n\n${testo}`, nome);
    const conferma = L.describe(a);
    assert.ok(conferma.includes('Titolo:') && conferma.includes(titolo), `${nome}: il riquadro dice il titolo`);
    assert.ok(conferma.includes(testo), `${nome}: il riquadro dice il testo`);
    assert.equal(L.REGISTRY.INVIA_FEEDBACK.uscita(a), `${titolo}\n${testo}`, `${nome}: il controllo delle uscite guarda quello che parte`);
    assert.equal(RA.riga({ ...a, _executed: true }).text, `Segnalazione inviata · ${titolo}`, nome);
  }
});

test('riaperta la chat, la riga di una segnalazione inviata, rifiutata o in attesa ha ancora titolo e testo nel fumetto (#1704.1)', () => {
  const atteso = `Timer muto\n\n${TESTO.trim()}`;
  const stati = {
    inviata: { ...base, _executed: true, _output: { id: 'fb-1' } },
    'non inviata': { ...base, _confirm: { level: 2, text: 'Inviare questo feedback' }, _rifiutata: true },
    'non riuscita': { ...base, _executed: false, _output: { error: 'problema di rete' } },
    'conferma chiesta': { ...base, _confirm: { level: 2, text: 'Inviare questo feedback' }, _executed: false },
    'titolo sotto il terzo nome': { type: 'INVIA_FEEDBACK', name: 'Timer muto', text: TESTO, _executed: true },
  };
  for (const [nome, a] of Object.entries(stati)) {
    // Come la salva la chat e come la rilegge riaperta: JSON, poi la voce già fatta.
    const salvata = JSON.parse(JSON.stringify(ESITO.voceArchivio(a)));
    const riaperta = ESITO.voceArchivio(salvata);
    const riga = ESITO.rigaDellaVoce(riaperta);
    assert.ok(riga, nome);
    assert.equal(riga.fumetto, atteso, nome);
  }
  // Una voce salvata da una versione di prima ha il solo testo: niente titolo inventato oggi.
  const vecchia = { type: 'INVIA_FEEDBACK', esito: 'fatto', riga: 'Segnalazione inviata · Timer muto', segnalazione: 'Non suona.' };
  assert.equal(ESITO.rigaDellaVoce(ESITO.voceArchivio(vecchia)).fumetto, 'Non suona.');
  assert.equal(ESITO.rigaDellaVoce({ type: 'TIMER', esito: 'fatto', riga: 'Timer avviato' }).fumetto, undefined);
});
