// #1921: le istruzioni della chat su domande, segnalazioni, trasparenza e nomi interni. Il comportamento lo decide il
// modello: qui si fissa che la regola resti scritta dove ogni modello la riceve (parte fissa, intervista, strumenti).
// Da #1564 la parte fissa dice il principio, non un caso per riga (SPEC-CONTESTO § La parte fissa).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const m of ['tabColor', 'constants', 'contenutoEsterno', 'preferences', 'onboarding', 'actionLevels', 'actionTools']) require(`../../src/shared/${m}.js`);
const { PROMPTS } = globalThis.SN_CONST;
const statico = PROMPTS.filoChatStatic();
const riga = (inizio) => statico.split('\n').find((l) => l.startsWith(inizio)) || '';
const strumento = (n) => globalThis.SN_ACTION_TOOLS.definitions().find((d) => d.function.name === n).function.description;

test('«cosa sai fare con X?» è una domanda a cui si risponde, senza segnalazione, anche da chi sviluppa Filo', () => {
  const r = riga('Quando Filo non sa fare una cosa');
  assert.match(r, /filo_su_di_se\(feedback\)/);
  assert.match(r, /Una domanda su cosa sa fare Filo invece è una domanda, anche se a farla è chi sviluppa Filo: si risponde, non si segnala/);
});

test('una mancanza si segnala nello stesso turno, col testo già scritto, e la conferma la chiede il sistema', () => {
  assert.match(riga('Quando Filo non sa fare una cosa'), /nello stesso turno filo_su_di_se\(feedback\) col testo già scritto/);
  assert.match(statico, /non chiedere il permesso a parole/);
  const capacita = PROMPTS.filoChatCapacita('Schede:\n  - Chiudere schede [chiudi-schede]');
  assert.match(capacita, /Quello che qui non c'è Filo non lo sa fare: non inventare procedure/);
});

test('«come scegli i modelli?» si legge con il documento di trasparenza, non a memoria', () => {
  assert.match(riga('Tutto quello che l\'utente può fare in Filo'), /perché ha scelto un modello, un'azienda o un prezzo, leggilo con lo strumento: non a memoria/);
  assert.match(strumento('filo_su_di_se'), /- documento\(doc\?\): [^\n]*leggilo prima di rispondere su questo/);
});

test('chiavi delle impostazioni e id delle capacità non finiscono nel testo per l\'utente', () => {
  const r = riga('Mai JSON nel testo');
  assert.match(r, /chiavi delle impostazioni, gli id fra parentesi quadre delle capacità/);
  assert.match(r, /nemmeno fra parentesi accanto al nome giusto e nemmeno se l'utente sviluppa Filo/);
  // L'esempio della regola è una chiave vera: se sparisse, l'esempio insegnerebbe un nome che non c'è.
  const esempio = r.match(/non «([a-z_]+)»/)[1];
  assert.ok(globalThis.SN_PREF.PREF_SETTERS.some((s) => s.keys[0] === esempio), `«${esempio}» non è più una chiave delle impostazioni`);
});

test('nell\'intervista ogni turno finisce con una battuta, anche dopo un\'impostazione', () => {
  const O = globalThis.SN_ONBOARDING;
  const blocco = PROMPTS.filoChatOnboarding({
    onboarding: O.renderChecklistForPrompt(O.emptyState()), onboardingTurns: 1, onboardingMax: O.MAX_EXCHANGES,
  });
  assert.match(blocco, /Ogni turno finisce con una battuta per l'utente: qui la risposta non è mai vuota, nemmeno dopo un'azione che parla da sé come impostazioni\(imposta\)/);
});
