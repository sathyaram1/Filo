// Unit test per #165: l'assistente della home (PROMPTS.filoChat) deve poter
// CANCELLARE la memoria solo tramite la vera azione CANCELLA_MEMORIA — quella
// che il sistema gate al livello 3 (l'utente digita "conferma"). Prima del fix
// l'azione esisteva nel backend ma NON era esposta all'LLM: chiedere "cancella
// le memorie" faceva confabulare il modello ("fatto, cancellate") senza avviso
// né cancellazione reale, e in una scheda nuova diceva "rimosse come richiesto".
//
// Due invarianti puri, testabili senza Electron né rete:
//   1) il prompt espone CANCELLA_MEMORIA (intent + azione disponibile);
//   2) il prompt vieta di inventare che la memoria è stata cancellata quando è
//      semplicemente vuota (e ricorda che ogni scheda parte da zero).

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
