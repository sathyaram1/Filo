// #2704: la verifica che il server manda al correttore (rilievi messi da parte dopo un rifiuto del cancello per unit
// rossi del ramo) lo dice a chi verifica, invece della frase dei rilievi che fermano per l'owner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('la risposta «rossi_del_ramo» dice che i rilievi vanno al correttore, non che decide l\'owner', async () => {
  const { verifierReplyText } = await import('../../scripts/dispatch.mjs');
  const testo = verifierReplyText({
    outcome: 'stop', motivo: 'rossi_del_ramo', testo: 'I rilievi vanno al correttore, con un giro suo oltre il bilancio.',
    blocking: [{ level: 2, sede: 'i', text: 'la sentinella del pavimento è rossa' }], sospesi: [], derived: [],
  });
  assert.match(testo, /i rilievi vanno al correttore/);
  assert.match(testo, /la sentinella del pavimento è rossa/);
  assert.match(testo, /rilascia il biglietto/);
  assert.doesNotMatch(testo, /decide l'owner/);
});
