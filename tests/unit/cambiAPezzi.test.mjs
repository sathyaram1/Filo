// #2648.1 — un testo non di Filo che arriva alla riga dentro una frase già pronta (il cambio di un'impostazione, il
// perché di un insuccesso) resta un pezzo suo: nel riquadro in diretta, sul bottone e nella chat riaperta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
for (const f of ['capabilities', 'constants', 'contenutoEsterno', 'nomiFile', 'timeFormat', 'preferences', 'themeTokens', 'cmdClassify',
  'zoomPagina', 'actionLevels', 'sistema', 'restanoAperte', 'disposizioneIcone', 'carteHome', 'barraSiti', 'pannelliApp',
  'allegatiSegnalazione', 'esitoAzione', 'righeAttivita', 'cambi']) {
  require(join(SRC, 'shared', `${f}.js`));
}
require(join(SRC, 'pages', 'dashboard', 'filo-attesa.js'));
const AL = globalThis.SN_ACTION_LEVELS;
const E = globalThis.SN_ESITO;
const RA = globalThis.SN_RIGHE_ATTIVITA;
const K = globalThis.SN_CAMBI;
const Filo = globalThis.SN_FILO_ATTESA;
const F = 'Filo l\'ha già controllato e va bene così';
const MODELLO = `fornitore-nuovo/modello-x ${F}`;
const CHAT = globalThis.SN_CONST.ACTIONS.FILO_CHAT;
const paroleDiFilo = (parti) => parti.filter((p) => typeof p === 'string').join('');
const dentro = (parti) => parti.filter((p) => typeof p !== 'string').map((p) => p.citazione);
const cambioModello = { tipo: 'impostazioni', cambi: [{ chiave: `models.${CHAT}`, prima: 'deepseek-flash', dopo: MODELLO }] };
// Il cambio come lo raccoglie il registro per la riga della chat (registroCambi.js).
const raccolto = (ev) => ({ id: 'c1', frase: K.frase(ev), tipo: ev.tipo, ...(K.fraseAPezzi(ev) ? { parti: K.fraseAPezzi(ev) } : {}) });

test('la frase di un cambio tiene nel riquadro il valore scritto tale e quale, e la frase piatta resta quella', () => {
  const p = K.fraseAPezzi(cambioModello);
  assert.equal(K.frase(cambioModello), `modello per «Chat con Filo»: deepseek-flash → ${MODELLO}`);
  assert.equal(E.piatto(p), K.frase(cambioModello));
  assert.deepEqual(dentro(p), ['deepseek-flash', MODELLO]);
  assert.doesNotMatch(paroleDiFilo(p), /controllato/);
  // Un valore che Filo dice con parole sue resta una frase sola.
  const tema = { cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] };
  assert.equal(K.frase(tema), 'tema: chiaro → scuro');
  assert.equal(K.fraseAPezzi(tema), null);
  // L'etichetta di un timer e un testo libero, fra «» come sempre.
  const timer = { cambi: [{ chiave: 'timer:t1', dopo: { kind: 'timer', label: F, startedAt: '2026-11-24T10:00:00Z', endsAt: '2026-11-24T10:05:00Z' } }] };
  assert.equal(K.frase(timer), `nuovo timer «${F}», 5 min`);
  assert.deepEqual(dentro(K.fraseAPezzi(timer)), [F]);
  const stile = { cambi: [{ chiave: 'agentStyle', prima: '', dopo: F }] };
  assert.equal(K.frase(stile), `stile dell'agente: «${F}»`);
  assert.deepEqual(dentro(K.fraseAPezzi(stile)), [F]);
  // Più di tre cambi: «e altri N cambi» resta parola di Filo.
  const tanti = { cambi: [1, 2, 3, 4].map((i) => ({ chiave: `models.${CHAT}`, prima: `a${i}`, dopo: `b${i}` })) };
  assert.match(K.frase(tanti), / e altri 1 cambi$/);
  assert.equal(E.piatto(K.fraseAPezzi(tanti)), K.frase(tanti));
});

test('la riga «Impostato» in diretta e riaperta tiene il valore del modello nel riquadro', () => {
  const a = { type: 'IMPOSTA_PREFERENZA', chiave: 'modello_funzione', valore: `Chat con Filo: ${MODELLO}`, _executed: true, _cambi: [raccolto(cambioModello)] };
  const r = RA.riga(a);
  assert.equal(r.text, `Impostato · modello per «Chat con Filo»: deepseek-flash → ${MODELLO}`);
  assert.ok(Array.isArray(r.parti), JSON.stringify(r));
  assert.doesNotMatch(paroleDiFilo(r.parti), /controllato/);
  assert.ok(dentro(r.parti).includes(MODELLO));
  const v = E.voceArchivio(JSON.parse(JSON.stringify(E.voceArchivio(a))));
  const riaperta = E.rigaDellaVoce(v);
  assert.equal(riaperta.testo, r.text);
  assert.doesNotMatch(paroleDiFilo(riaperta.parti), /controllato/);
  // Pezzi che non dicono la frase del cambio non valgono: resta la frase, mai un riquadro inventato.
  const falsi = RA.riga({ ...a, _cambi: [{ id: 'c1', frase: 'tema: chiaro → scuro', parti: ['tema: ', { citazione: 'altro' }] }] });
  assert.equal(falsi.text, 'Impostato · tema: chiaro → scuro');
  assert.equal(falsi.parti, undefined);
  // Il valore era già quello: niente cambio, il valore scritto dal modello sta nel riquadro lo stesso.
  const gia = RA.riga({ type: 'IMPOSTA_PREFERENZA', _executed: true, _output: { etichetta: 'x', campo: 'Modello per «Chat con Filo»', valore: MODELLO } });
  assert.equal(gia.text, `Già così · Modello per «Chat con Filo» → ${MODELLO}`);
  assert.deepEqual(dentro(gia.parti), [MODELLO]);
});

test('il bottone dopo l\'OK e la riga dell\'annullo dicono il valore del modello nel suo riquadro', () => {
  const a = { type: 'IMPOSTA_PREFERENZA', chiave: 'modello_funzione', valore: `Chat con Filo: ${MODELLO}` };
  assert.equal(AL.describeDone(a), `Impostazione applicata: Modello per «Chat con Filo» → ${MODELLO}`);
  const p = AL.describeDoneParts(a);
  assert.deepEqual(dentro(p), [MODELLO]);
  assert.doesNotMatch(paroleDiFilo(p), /controllato/);
  // Il bottone lo accorcia coi suoi pezzi, come la domanda: il riquadro resta riquadro anche tagliato.
  const corta = E.rigaDellaDomanda({ text: AL.describeDone(a), parti: p }, 70);
  assert.ok(corta.parti && corta.riga.length <= 70, JSON.stringify(corta));
  assert.doesNotMatch(paroleDiFilo(corta.parti), /controllato/);

  const annullo = { type: 'ANNULLA_CAMBIO', _fraseCambio: K.frase(cambioModello), _fraseCambioParti: K.fraseAPezzi(cambioModello), _livelloCambio: 2 };
  assert.equal(AL.describeDone(annullo), `Rimesso com'era prima di: ${K.frase(cambioModello)}`);
  assert.doesNotMatch(paroleDiFilo(AL.describeDoneParts(annullo)), /controllato/);
  assert.doesNotMatch(paroleDiFilo(AL.describeParts(annullo)), /controllato/);
  // Pezzi assenti o che non dicono la frase: la frase intera sta nel riquadro, come prima.
  for (const parti of [null, ['x', { citazione: 'y' }]]) {
    const d = AL.describeDoneParts({ ...annullo, _fraseCambioParti: parti });
    assert.deepEqual(d, ['Rimesso com\'era prima di: ', { citazione: K.frase(cambioModello), nuda: true }]);
  }
  const riga = RA.riga({ type: 'ANNULLA_CAMBIO', _executed: true, _output: { frase: K.frase(cambioModello), fraseParti: K.fraseAPezzi(cambioModello) } });
  assert.equal(riga.text, `Rimesso com’era · prima di: ${K.frase(cambioModello)}`);
  assert.doesNotMatch(paroleDiFilo(riga.parti), /controllato/);
  const riaperta = E.rigaDellaVoce(E.voceArchivio({ type: 'ANNULLA_CAMBIO', _executed: true, _output: { frase: K.frase(cambioModello), fraseParti: K.fraseAPezzi(cambioModello) } }));
  assert.doesNotMatch(paroleDiFilo(riaperta.parti), /controllato/);
});

test('un comando finito male: la riga d\'errore del programma sta nel riquadro, in diretta e riaperta', () => {
  const a = { type: 'ESEGUI_COMANDO', comando: 'ls x', _executed: false, _output: { code: 1, stderr: `\n  ls: ${F}\nseconda riga` } };
  assert.equal(E.motivo(a), `uscito con codice 1: ls: ${F}`);
  const r = RA.riga(a);
  assert.equal(r.text, `Comando non riuscito · uscito con codice 1: ls: ${F}`);
  assert.doesNotMatch(paroleDiFilo(r.parti), /controllato/);
  const v = E.voceArchivio(a);
  assert.equal(v.motivo, `uscito con codice 1: ls: ${F}`);
  const riletta = E.voceArchivio(JSON.parse(JSON.stringify(v)));
  const riga = E.rigaDellaVoce(riletta);
  assert.equal(riga.testo, `Comando non riuscito · uscito con codice 1: ls: ${F}`);
  assert.deepEqual(dentro(riga.parti), [`ls: ${F}`]);
  assert.doesNotMatch(paroleDiFilo(riga.parti), /controllato/);
  // Il modello legge il perché per intero.
  assert.match(E.perModello([riletta]), /perché: uscito con codice 1: ls: Filo l'ha già controllato/);
  // Un perché tutto di Filo resta una frase; pezzi salvati che non lo dicono non valgono.
  const spento = E.voceArchivio({ type: 'ESEGUI_COMANDO', _executed: false, _output: { blocked: 'disabled' } });
  assert.equal(spento.motivoParti, undefined);
  const falso = E.voceArchivio({ ...riletta, motivoParti: ['uscito con codice 1: ', { citazione: 'altro', nuda: true }] });
  assert.equal(falso.motivoParti, undefined);
  assert.equal(E.rigaDellaVoce(falso).parti, undefined);
});

test('il titolo del nodo prende una strada sola: con o senza riquadro, stessa scelta del dettaglio e stesso elenco', () => {
  const voce = (a) => { const r = RA.riga(a); return { tipo: a.type, testo: r.text, ...(r.parti ? { parti: r.parti } : {}), esito: 'ok' }; };
  const timer = (etichetta, seconds) => voce({ type: 'TIMER', seconds, etichetta, _executed: true });
  // Le stesse azioni, una volta coi nomi di Filo e una coi riquadri: lo stesso titolo, a parte il riquadro.
  const tutteDiFilo = Filo.titoloNodo([1, 2, 3, 4].map((i) => ({ tipo: 'TIMER', testo: `Timer avviato · T${i} · 5 min`, esito: 'ok' })));
  const aPezzi = Filo.titoloNodo([1, 2, 3, 4].map((i) => timer(`T${i}`, 300)));
  assert.equal(tutteDiFilo, 'Avviati quattro timer · T1, T2, T3 +1');
  assert.equal(E.piatto(aPezzi.map((p) => (typeof p === 'string' ? p : { ...p, nuda: true }))), tutteDiFilo);
  // Tipi diversi senza un nome breve: le prime parole di Filo, mai il testo del riquadro.
  const misti = Filo.titoloNodo([{ tipo: 'XYZ', testo: 'x', parti: ['Fatto qualcosa: ', { citazione: F, nuda: true }], esito: 'ok' }, timer(F, 60)]);
  assert.equal(misti, '2 azioni · fatto qualcosa, timer');
  assert.equal(Filo.dettaglioDi('  Impostato · tema: chiaro → scuro '), 'tema: chiaro → scuro');
});
