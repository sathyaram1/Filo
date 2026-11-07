// I client hints che Electron non manda (#1616): si aggiungono se mancano col marchio onesto «Chromium» e la versione
// vera, la lista delle versioni piene si riscrive solo se c'è già, mai «Google Chrome», e le intestazioni date restano
// intatte. Regole in src/main/services/clientHints.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { completaClientHints, piattaforma } = require('../../src/main/services/clientHints.js');

const VERSIONE = '130.0.6723.59';
const base = () => ({ 'User-Agent': 'Mozilla/5.0 Chrome/130.0.0.0', Accept: '*/*' });

test('senza hint ne aggiunge tre, onesti, e lascia il resto com\'era', () => {
  const dati = base();
  const out = completaClientHints(dati, { versione: VERSIONE, platform: 'win32' });
  assert.equal(out['Sec-CH-UA'], '"Not?A_Brand";v="24", "Chromium";v="130"');
  assert.equal(out['Sec-CH-UA-Mobile'], '?0');
  assert.equal(out['Sec-CH-UA-Platform'], '"Windows"');
  assert.equal(out['Sec-CH-UA-Full-Version-List'], undefined, 'la lista piena non si aggiunge: Chrome la manda solo a chi la chiede');
  assert.equal(out['User-Agent'], dati['User-Agent']);
  assert.equal(out.Accept, '*/*');
  assert.deepEqual(dati, base(), 'le intestazioni date non si toccano');
});

test('la piattaforma segue il sistema: Windows, macOS, Linux', () => {
  assert.equal(piattaforma('win32'), 'Windows');
  assert.equal(piattaforma('darwin'), 'macOS');
  assert.equal(piattaforma('linux'), 'Linux');
  assert.equal(completaClientHints({}, { versione: VERSIONE, platform: 'darwin' })['Sec-CH-UA-Platform'], '"macOS"');
  assert.equal(completaClientHints({}, { versione: VERSIONE, platform: 'linux' })['Sec-CH-UA-Platform'], '"Linux"');
});

test('un hint già presente, con qualunque maiuscola, resta quello: gli altri si aggiungono', () => {
  const out = completaClientHints({ 'sec-ch-ua': '"Chromium";v="129"', 'Sec-Ch-Ua-Mobile': '?1' }, { versione: VERSIONE, platform: 'win32' });
  assert.equal(out['sec-ch-ua'], '"Chromium";v="129"');
  assert.equal(out['Sec-CH-UA'], undefined);
  assert.equal(out['Sec-Ch-Ua-Mobile'], '?1');
  assert.equal(out['Sec-CH-UA-Mobile'], undefined);
  assert.equal(out['Sec-CH-UA-Platform'], '"Windows"');
});

test('la lista delle versioni piene si riscrive solo se c\'è già, con la versione vera e lo stesso marchio di riempimento', () => {
  const out = completaClientHints({ 'sec-ch-ua-full-version-list': '"Not/A)Brand";v="8.0.0.0", "Chromium";v="1.2.3.4"' }, { versione: VERSIONE, platform: 'win32' });
  assert.equal(out['sec-ch-ua-full-version-list'], `"Not?A_Brand";v="24.0.0.0", "Chromium";v="${VERSIONE}"`);
  assert.equal(out['Sec-CH-UA-Full-Version-List'], undefined);
});

test('mai «Google Chrome», in nessun header', () => {
  const out = completaClientHints({ 'Sec-CH-UA-Full-Version-List': 'x' }, { versione: VERSIONE, platform: 'win32' });
  assert.ok(!JSON.stringify(out).includes('Google Chrome'), JSON.stringify(out));
});

test('senza una versione di Chromium leggibile non inventa niente', () => {
  assert.deepEqual(completaClientHints({ Accept: '*/*' }, { versione: undefined, platform: 'win32' }), { Accept: '*/*' });
  assert.deepEqual(completaClientHints({ Accept: '*/*' }, { versione: 'boh', platform: 'win32' }), { Accept: '*/*' });
  assert.deepEqual(completaClientHints(undefined, { versione: 'boh', platform: 'win32' }), {});
});
