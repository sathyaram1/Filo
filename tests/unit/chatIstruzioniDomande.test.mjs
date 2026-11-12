// #1921: le istruzioni della chat su domande, segnalazioni, trasparenza e nomi interni. Il comportamento lo decide il
// modello: qui si fissa che la regola resti scritta dove ogni modello la riceve (parte fissa, intervista, strumenti).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const m of ['tabColor', 'constants', 'contenutoEsterno', 'preferences', 'onboarding']) require(`../../src/shared/${m}.js`);
const { PROMPTS } = globalThis.SN_CONST;
const statico = PROMPTS.filoChatStatic();
const riga = (inizio) => statico.split('\n').find((l) => l.startsWith(inizio)) || '';

test('«cosa sai fare con X?» è una domanda a cui si risponde, senza segnalazione', () => {
  const r = riga('CHE COSA SAI FARE (');
  assert.match(r, /cosa posso farti fare con le schede/);
  assert.match(r, /DOMANDA/);
  assert.match(r, /niente INVIA_FEEDBACK/);
  assert.ok(statico.indexOf(r) < statico.indexOf('SEGNALA UN PROBLEMA'), 'la domanda va letta prima della regola sulle segnalazioni');
});

test('una segnalazione non risponde mai a una domanda, nemmeno di chi sviluppa Filo', () => {
  assert.match(riga('SEGNALA UN PROBLEMA'), /mai per rispondere a una domanda: vale anche se l'utente sviluppa Filo/);
  const capacita = PROMPTS.filoChatCapacita('Schede:\n  - Chiudere schede [chiudi-schede]');
  assert.match(capacita, /Se chiede una cosa precisa e NESSUNA voce/);
});

test('«come scegli i modelli?» si legge con LEGGI_TRASPARENZA, non si dice che il documento manca', () => {
  const r = riga('PERCHÉ FILO FA COSÌ (');
  assert.match(r, /come scegli i modelli/);
  assert.match(r, /SUBITO LEGGI_TRASPARENZA/);
  assert.match(r, /Non dire che il documento non ce l'hai e non offrirti di leggerlo/);
});

test('una mancanza si ammette solo dopo aver chiamato lo strumento che legge quel dato', () => {
  const r = riga('QUANDO AMMETTI UNA MANCANZA');
  assert.match(r, /LEGGI_TRASPARENZA, LEGGI_IMPOSTAZIONI, CAPACITA_DETTAGLIO, CERCA_CHAT/);
  assert.match(r, /citi solo esiti che hai ricevuto davvero/);
});

test('chiavi delle impostazioni e id delle capacità non finiscono nel testo per l\'utente', () => {
  const r = riga('Mai JSON nel testo');
  assert.match(r, /chiavi delle impostazioni, gli id fra parentesi quadre delle capacità/);
  assert.match(r, /nemmeno fra parentesi accanto al nome giusto e nemmeno se l'utente sviluppa Filo/);
  // Le chiavi il modello le legge negli strumenti delle impostazioni: lì il richiamo sta accanto all'elenco.
  require('../../src/shared/actionLevels.js');
  require('../../src/shared/actionTools.js');
  const desc = (n) => globalThis.SN_ACTION_TOOLS.definitions().find((d) => d.function.name === n).function.description;
  assert.match(desc('IMPOSTA_PREFERENZA'), /le chiavi servono alla chiamata, all'utente dici la voce a parole/);
  assert.match(desc('LEGGI_IMPOSTAZIONI'), /la chiave serve alle tue chiamate: all'utente dici il nome della voce/);
  // L'esempio della regola è una chiave vera: se sparisse dall'elenco, l'esempio insegnerebbe un nome che non c'è.
  const esempio = r.match(/non «([a-z_]+)»/)[1];
  const chiavi = globalThis.SN_PREF.righeDescrizione({}).map((l) => (l.match(/^• ([^:]+):/) || [])[1]);
  assert.ok(chiavi.includes(esempio), `«${esempio}» non è più una chiave di IMPOSTA_PREFERENZA`);
});

test('nell\'intervista ogni turno finisce con una battuta, anche dopo un\'impostazione', () => {
  const O = globalThis.SN_ONBOARDING;
  const blocco = PROMPTS.filoChatOnboarding({
    onboarding: O.renderChecklistForPrompt(O.emptyState()), onboardingTurns: 1, onboardingMax: O.MAX_EXCHANGES,
  });
  assert.match(blocco, /Ogni turno finisce con una battuta per l'utente: qui la risposta non è mai vuota, nemmeno dopo un'azione che parla da sé come IMPOSTA_PREFERENZA/);
});
