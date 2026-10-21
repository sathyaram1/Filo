// Verifica #1375 giro 1: un marchio di tre o quattro lettere che capita per caso dentro un pezzo di nome generato a
// caso (sottodomini di servizi cloud, anteprime) non è un'imitazione; su main questi nomi erano puliti.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'main', 'services', 'safebrowse');
const { evaluate } = require(join(SB, 'engine.js'));

const CASUALI = [
  'x1tuyb9bunqa2.esempio-ostile.com', 'xg2bukfvpsdh10.esempio-ostile.com', 'xr7in9n26zv16.esempio-ostile.com',
  'dhl5205f2.cloudfront.net', 'v379gkgj66dthdhl.execute-api.us-east-1.amazonaws.com', '4xe3odby-dh19lk58.vercel.app',
  'igls2i7v-6xop9h3r.vercel.app', '1eyaho3e.ngrok.io',
];

test('r2 un pezzo di nome generato a caso non diventa l’imitazione di un marchio corto', () => {
  const presi = CASUALI.filter((h) => evaluate('https://' + h + '/').imp)
    .map((h) => h + ' → ' + evaluate('https://' + h + '/').imp.brand.token);
  expect(presi, 'nomi casuali presi per imitazioni').toEqual([]);
});
