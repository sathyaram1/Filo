// #165: la chat cancella la memoria solo con lo strumento vero, che il sistema ferma su «conferma»; senza, il modello
// diceva «fatto, cancellate» senza cancellare, e a memoria vuota «rimosse come richiesto».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;

const basePayload = { profilo: '', preferenze: '', stato: '' };

test('la chat ha memoria(cancella_tutto), e la parte fissa dice che la conferma è del sistema e il fatto dell\'esito', () => {
  require(join(__dirname, '..', '..', 'src', 'shared', 'actionTools.js'));
  const memoria = globalThis.SN_ACTION_TOOLS.definitions().find((d) => d.function.name === 'memoria').function.description;
  // Senza lo strumento il modello non può cancellare: confabula «fatto» (#165).
  assert.match(memoria, /- cancella_tutto\(\): cancella tutta la memoria di Filo/);
  const p = C.PROMPTS.filoChatStatic();
  // Cancellare per sempre vuole «conferma», che apre il sistema (#1312), e non si dichiara prima dell'esito.
  assert.match(p, /fanno scrivere «conferma» all'utente\. Tu chiami l'azione e basta: non chiedere il permesso a parole/);
  assert.match(p, /Non dire fatto niente che l'esito non conferma/);
});

test('PROMPTS.filoChat: vieta di confabulare sulla memoria vuota', () => {
  const p = C.PROMPTS.filoChat({ ...basePayload });
  // Il guard del feedback #165: niente "rimosse come richiesto" / "cancellate"
  // quando la memoria è solo vuota, e ogni scheda parte da una conversazione
  // nuova (non sa cosa è successo in un'altra scheda).
  assert.match(p, /rimosse come richiesto|sono state cancellate/i);
  assert.match(p, /scheda parte (da )?(una )?conversazione nuova|altra scheda/i);
});
