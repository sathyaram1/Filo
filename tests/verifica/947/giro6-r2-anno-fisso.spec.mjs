// #947 giro 6: l'esempio che le istruzioni danno al modello per «la bolletta della luce di marzo» porta l'anno 2026
// scritto fisso. Dal 2027 un modello che lo ricopia cerca la bolletta dell'anno prima, e la ricerca (dove l'anno chiesto
// vale come anno del periodo) mette quella in cima. Logica pura: si guarda la descrizione con l'orologio nel 2027.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function descrizioneNel(anno) {
  const Vera = globalThis.Date;
  const fisso = new Vera(`${anno}-04-03T10:00:00Z`).getTime();
  class Finta extends Vera {
    constructor(...a) { super(...(a.length ? a : [fisso])); }
    static now() { return fisso; }
  }
  globalThis.Date = Finta;
  try {
    const file = require.resolve('../../../src/shared/actionTools.js');
    delete require.cache[file];
    delete globalThis.SN_ACTION_TOOLS;
    require(file);
    const def = globalThis.SN_ACTION_TOOLS.definitions({}).find((d) => d.function.name === 'CERCA_DOCUMENTI');
    return `${def.function.description}\n${JSON.stringify(def.function.parameters)}`;
  } finally {
    globalThis.Date = Vera;
  }
}

test('r2 ad aprile 2027 l\'esempio dato al modello non gli fa cercare la bolletta di marzo 2026', () => {
  const testo = descrizioneNel(2027);
  expect(testo).toContain('bolletta');
  expect(testo, 'un anno passato scritto fisso nell\'esempio').not.toMatch(/\b2026\b/);
});

test('r2 la ricerca con l\'anno ricopiato dall\'esempio mette davvero in cima la bolletta dell\'anno prima', () => {
  // È il motivo per cui l'esempio conta: con «marzo 2026» nella richiesta vince marzo 2026 anche se c'è marzo 2027.
  const Ricerca = require('../../../src/main/services/documentiRicerca.js');
  const bolletta = (y) => [`Bolletta n. 41 del 08/04/${y}`, 'Fornitura di energia elettrica', `Periodo di fatturazione: 01/03/${y} - 31/03/${y}`, '212 kWh'].join('\n');
  const docs = [{ id: 'mar2026', nome: 'a.pdf', data: 1, testo: bolletta(2026) }, { id: 'mar2027', nome: 'b.pdf', data: 2, testo: bolletta(2027) }];
  expect(Ricerca.ordina(docs, 'bolletta luce energia elettrica kWh marzo 2026')[0].id).toBe('mar2026');
});
