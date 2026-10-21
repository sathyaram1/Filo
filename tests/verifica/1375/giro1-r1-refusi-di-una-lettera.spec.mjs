// Verifica #1375 giro 1: i refusi di una lettera sul nome di un marchio noto (in coda, raddoppiata, cambiata) restano
// imitazioni, all'apertura e nel menu del link: le regole di prima li prendevano tutti.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'main', 'services', 'safebrowse');
const { evaluate, codiceImitazione } = require(join(SB, 'engine.js'));

const REFUSI = [
  'paypall.com', 'amazonn.com', 'amazone.com', 'microsoftt.com', 'microsofts.com', 'googlee.com', 'googles.com',
  'linkedinn.com', 'ebayy.com', 'yahooo.com', 'gmaill.com', 'icloudd.com', 'ledgerr.com', 'gogle.com', 'yatoo.com',
  'postetaliane.it', 'amazonn.it',
];

test('r1 i refusi di una lettera sul nome di un marchio danno l’avviso all’apertura e nel menu', () => {
  const persi = REFUSI.filter((h) => {
    const u = 'https://' + h + '/';
    return evaluate(u).level === 'safe' || !codiceImitazione(u);
  });
  expect(persi, 'refusi senza avviso').toEqual([]);
});
