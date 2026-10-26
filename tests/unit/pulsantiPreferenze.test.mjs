// #1619 — i pulsanti della pagina Preferenze si chiedono anche in chat: logica pura (src/shared/pulsantiPreferenze.js)
// e il peso di ognuno nel registro. Rossi senza il lavoro: lo strumento non esisteva e la chat spiegava dove cliccare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
globalThis.window = globalThis;
for (const m of ['constants', 'tabColor', 'ttsVoices', 'autonomia', 'preferences', 'cambi', 'pulsantiPreferenze',
  'actionLevels', 'actionTools', 'vociImpostazioni']) {
  require(join(ROOT, 'src', 'shared', `${m}.js`));
}
const P = globalThis.SN_PULSANTI_PREFERENZE;
const AL = globalThis.SN_ACTION_LEVELS;
const K = globalThis.SN_CAMBI;
const C = globalThis.SN_CONST;
const diSerie = () => JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS));
const azione = (pulsante, extra = {}) => ({ type: 'PULSANTE_PREFERENZE', pulsante, ...extra });

test('i pulsanti si riconoscono anche scritti male, uno sconosciuto no', () => {
  assert.equal(P.pulsanteDi({ pulsante: 'Prova Suoneria' }), 'prova_suoneria');
  assert.equal(P.pulsanteDi({ pulsante: 'ripristina-tutto' }), 'ripristina_tutto');
  assert.equal(P.pulsanteDi({ pulsante: 'esporta_dati' }), '');
  assert.equal(P.pulsanteDi({}), '');
});

test('la prova di un tono: quello detto, o quello scelto, sempre col volume salvato', () => {
  const s = diSerie();
  s.timerRingtone = 'gentle';
  s.timerRingtoneVolume = 35;
  assert.deepEqual(P.provaTono(azione('prova_suoneria'), s),
    { tono: 'gentle', volume: 35, etichetta: 'Delicata', suoneria: true, acceso: true });
  assert.equal(P.provaTono(azione('prova_suoneria', { tono: 'carillon' }), s).tono, 'chime');
  // Il suono degli avvisi di serie è spento: la prova suona, e l'esito lo dice.
  const avvisi = P.provaTono(azione('prova_suono', { tono: 'urgente' }), s);
  assert.equal(avvisi.tono, 'urgent');
  assert.equal(avvisi.acceso, false);
  s.timerRingtoneVolume = 0;
  assert.equal(P.provaTono(azione('prova_suoneria'), s).volume, 0);
});

test('un tono che non c\'è è un rifiuto coi toni ammessi, e lo ripete corto', () => {
  const r = P.provaTono(azione('prova_suono', { tono: `x${'z'.repeat(200)}` }), diSerie());
  assert.match(r.rifiuto, /standard, delicata, urgente e carillon/);
  assert.ok(r.rifiuto.length < 160, r.rifiuto);
});

test('la prova di una voce: per nome, o quella scelta; la frase è della lingua della voce', () => {
  const s = diSerie();
  const nicola = P.provaVoce(azione('prova_voce', { voce: 'Nicola' }), s);
  assert.equal(nicola.voce, 'im_nicola');
  assert.equal(nicola.etichetta, 'Nicola');
  assert.equal(nicola.testo, globalThis.SN_TTS_VOICES.FRASI_DI_PROVA.it);
  const scelta = P.provaVoce(azione('prova_voce'), { ...s, tts: { ...s.tts, modelVoice: 'im_nicola' } });
  assert.equal(scelta.voce, 'im_nicola');
  assert.equal(P.provaVoce(azione('prova_voce'), s).etichetta, 'automatica');
});

test('un nome di voce oltre il tetto è un rifiuto col numero, non un nome tagliato', () => {
  const r = P.provaVoce(azione('prova_voce', { voce: 'x'.repeat(300) }), diSerie());
  assert.match(r.rifiuto, /300/);
});

test('il ripristino scrive le impostazioni di serie intere: restano le chiavi e il registro, l\'autonomia non sale', () => {
  const correnti = {
    ...diSerie(), theme: 'dark', residuo: 'vecchio', apiKeys: { openrouter: 'k-utente' }, modelRegistry: [{ id: 'm' }],
    autonomia: { ...diSerie().autonomia, livello: 'conservativo' },
  };
  const dopo = P.impostazioniDiSerie(correnti);
  assert.equal(dopo.theme, C.DEFAULT_SETTINGS.theme);
  assert.ok(!('residuo' in dopo));
  assert.deepEqual(dopo.apiKeys, { openrouter: 'k-utente' });
  assert.deepEqual(dopo.modelRegistry, [{ id: 'm' }]);
  assert.equal(dopo.autonomia.livello, 'conservativo');
});

test('registro: le prove suonano e basta, rifare l\'intervista si rimedia, il ripristino pesa quanto il suo annullo', () => {
  assert.equal(AL.costoFor(azione('prova_suono')), 0);
  assert.equal(AL.costoFor(azione('prova_voce')), 0);
  assert.equal(AL.costoFor(azione('rifai_intervista')), 1);
  // Niente da cambiare: niente da confermare.
  assert.equal(AL.costoFor(azione('ripristina_tutto', { _ripristino: { frasi: [], livello: 1 } })), 0);
  const correnti = { ...diSerie(), theme: 'dark' };
  const cambi = K.cambiImpostazioni(correnti, P.impostazioniDiSerie(correnti), (x) => x);
  const leggero = azione('ripristina_tutto', { _ripristino: { frasi: K.frasi({ cambi }), livello: K.livello({ cambi }) } });
  assert.equal(AL.costoFor(leggero), 2);
  assert.equal(AL.REGISTRY.PULSANTE_PREFERENZE.difesa(leggero), false);
  // Un clic a ogni livello, anche ad Automatico: tutte insieme non si rimettono da sole.
  assert.equal(AL.REGISTRY.PULSANTE_PREFERENZE.perimetro(leggero), false);
  assert.equal(AL.REGISTRY.PULSANTE_PREFERENZE.perimetro(azione('prova_suono')), true);
  const sicurezza = { ...diSerie(), security: { ...diSerie().security, blockPopups: !diSerie().security.blockPopups } };
  const cambiS = K.cambiImpostazioni(sicurezza, P.impostazioniDiSerie(sicurezza), (x) => x);
  const pesante = azione('ripristina_tutto', { _ripristino: { frasi: K.frasi({ cambi: cambiS }), livello: K.livello({ cambi: cambiS }) } });
  assert.equal(AL.REGISTRY.PULSANTE_PREFERENZE.difesa(pesante), true, 'tocca la sicurezza: vuole «conferma»');
});

test('il popup del ripristino elenca cosa cambia, nei riquadri, e dice come si torna indietro', () => {
  const parti = AL.describeParts(azione('ripristina_tutto', { _ripristino: { frasi: ['tema: scuro → come il sistema', 'durata delle notifiche: 30 s → 5 s'], livello: 1 } }));
  const riquadro = parti.find((p) => p && p.elenco);
  assert.deepEqual(riquadro.elenco, ['tema: scuro → come il sistema', 'durata delle notifiche: 30 s → 5 s']);
  const parole = parti.filter((p) => typeof p === 'string').join('');
  assert.match(parole, /2 impostazioni/);
  assert.match(parole, /annulla/);
});

test('i canali dei pulsanti della pagina Preferenze hanno la loro strada dalla chat', () => {
  const m = globalThis.SN_VOCI_IMPOSTAZIONI.PAGINE.preferences.messaggi;
  for (const canale of ['RESET_SETTINGS', 'FILO_RESTART_ONBOARDING', 'TTS_SYNTH']) assert.equal(m[canale], 'PULSANTE_PREFERENZE', canale);
  assert.ok(globalThis.SN_ACTION_TOOLS.NAMES.includes('PULSANTE_PREFERENZE'));
});

test('la chat non manda l\'utente a cercare in Preferenze ciò che sceglie solo lui: gli apre la pagina sul punto', () => {
  const prompt = readFileSync(join(ROOT, 'src', 'shared', 'constants.js'), 'utf8');
  assert.match(prompt, /PULSANTE_PREFERENZE/);
  assert.match(prompt, /filo:\/\/preferences\/preferences\.html#autonomia/);
  const html = readFileSync(join(ROOT, 'src', 'pages', 'preferences', 'preferences.html'), 'utf8');
  for (const id of ['autonomia', 'restartOnboarding']) assert.match(html, new RegExp(`id="${id}"`), `#${id} non c'è più nella pagina`);
});
