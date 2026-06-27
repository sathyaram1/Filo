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

test('PROMPTS.filoChat: espone l\'azione CANCELLA_MEMORIA all\'LLM', () => {
  const p = C.PROMPTS.filoChat({ ...basePayload });
  // L'azione compare sia come intent ("dimentica tutto di me") sia nell'elenco
  // delle azioni disponibili: senza questo il modello non può emetterla.
  assert.match(p, /CANCELLA_MEMORIA/);
  assert.match(p, /dimentica tutto di me|azzera quello che sai/i);
  // E spiega che è il SISTEMA a chiedere "conferma" (livello 3), non l'LLM.
  assert.match(p, /CANCELLAZIONE MEMORIA[\s\S]*conferma/i);
});

test('PROMPTS.filoChat: vieta di confabulare sulla memoria vuota', () => {
  const p = C.PROMPTS.filoChat({ ...basePayload });
  // Il guard del feedback #165: niente "rimosse come richiesto" / "cancellate"
  // quando la memoria è solo vuota, e ogni scheda parte da una conversazione
  // nuova (non sa cosa è successo in un'altra scheda).
  assert.match(p, /rimosse come richiesto|sono state cancellate/i);
  assert.match(p, /scheda parte (da )?(una )?conversazione nuova|altra scheda/i);
});
