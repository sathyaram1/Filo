// Verifica #730 giro 4, rilievo 1: un sosia col marchio incollato a una parola qualunque (paypalresolution) su una
// piattaforma di hosting deve restare un avviso, come su main; le parole che contengono un marchio-parola per caso no.
// Un marchio distintivo dentro un nome onesto (amazonas-tours) può avere l'avviso: decisione dell'owner.
import { test, expect } from '../../fixtures/electron.mjs';

const SOSIA = [
  'paypalresolution.vercel.app', 'paypaldispute.netlify.app', 'paypalinc.github.io',
  'amazonprimevideo.netlify.app', 'netflixpremium.vercel.app', 'coinbasepro.github.io',
  'binancefutures.netlify.app', 'instagramcopyright.vercel.app', 'facebookbusiness.netlify.app',
  'metamaskrestore.netlify.app', 'metamaskextension.github.io', 'paypalresolution.weebly.com',
];
const ONESTI = [
  'pineapple-bakery.wixsite.com', 'steampunk-fiera.weebly.com', 'proposte-viaggi.webflow.io',
  'purchase-tickets.carrd.co', 'otherwise-studio.framer.app', 'streetwise.wixsite.com',
];

test('il marchio incollato a una parola qualunque resta un sosia sui siti ospitati', async ({ app }) => {
  const livelli = await app.evaluate((_electron, urls) => {
    const SB = globalThis.SN_SAFEBROWSE;
    return Object.fromEntries(urls.map((h) => [h, SB.checkSync(`https://${h}/`, {}).level]));
  }, [...SOSIA, ...ONESTI]);
  const passati = SOSIA.filter((h) => livelli[h] === 'safe');
  expect(passati, 'sosia senza avviso').toEqual([]);
  const avvisati = ONESTI.filter((h) => livelli[h] !== 'safe');
  expect(avvisati, 'siti onesti avvisati').toEqual([]);
});
