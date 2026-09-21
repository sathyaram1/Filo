// Prova del giro 1: un testo di ruolo consegnato con un buco dentro deve
// fermare, sempre.
//
// Il pezzo condiviso che MANCA ferma (ed è giusto). Ma un richiamo a un pezzo
// condiviso che lo strumento non sa espandere — dentro un altro pezzo
// condiviso, oppure scritto in coda a una riga invece che da solo — non ferma
// niente: passa così com'è e arriva a chi lavora come una riga di commento
// vuota, al posto delle regole che doveva portare. È lo stesso danno da cui il
// controllo sul pezzo mancante difende, dalla porta accanto.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { espandiInclusioni } from '../../../scripts/lib/role-text.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

function cartellaConPezzi() {
  const d = cartellaTemporanea('ruoli-buco');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '_esterno.md'), 'inizio\n<!-- includi: _interno.md -->\nfine');
  writeFileSync(join(d, '_interno.md'), 'LE REGOLE CHE CONTANO');
  return d;
}

test('un pezzo condiviso richiamato dentro un altro arriva davvero a chi lavora', () => {
  test.fail(true, 'rilievo aperto: il richiamo annidato non viene espanso e non ferma: il ruolo parte con un buco');
  const d = cartellaConPezzi();
  const testo = espandiInclusioni('<!-- includi: _esterno.md -->', d);
  expect(testo).toContain('LE REGOLE CHE CONTANO');
});

test('un richiamo che lo strumento non sa espandere ferma invece di passare', () => {
  test.fail(true, 'rilievo aperto: un richiamo non a inizio riga passa intatto nel testo consegnato');
  const d = cartellaConPezzi();
  let fermato = false;
  let testo = '';
  try {
    testo = espandiInclusioni('coda della riga <!-- includi: _interno.md -->', d);
  } catch (_) {
    fermato = true;
  }
  expect(fermato || testo.includes('LE REGOLE CHE CONTANO'),
    'il richiamo è finito nel testo consegnato senza le regole e senza un errore').toBe(true);
});
