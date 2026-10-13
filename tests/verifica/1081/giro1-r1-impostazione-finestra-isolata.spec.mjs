// Verifica #1081 giro 1, rilievo 1: nessuna funzione prova più un link nella finestra nascosta, quindi l'impostazione
// che la governa non deve promettere che Filo segue prima i link sospetti (né in Sicurezza né a parole con Filo).

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROMESSA = /(li apre prima|segue prima|segue dove portano|fa aprire quei link direttamente)/i;

test('r1 la pagina Sicurezza non promette di aprire prima i link sospetti in una finestra isolata', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await page.waitForSelector('#sec-safebrowse', { timeout: 8_000 });
  const toggle = page.locator('#sec-safebrowse-sandbox');
  if (await toggle.count() && await toggle.isVisible()) {
    const testo = `${await page.locator('#sec-safebrowse-sandbox-label').innerText()} ${await page.locator('#sec-safebrowse-sandbox-desc').innerText()}`;
    expect(testo).not.toMatch(PROMESSA);
  }
});

test('r1 chiesta a Filo, l\'impostazione della finestra isolata non promette di seguire prima i link', () => {
  const src = readFileSync(join(ROOT, 'src/shared/preferences.js'), 'utf8');
  const i = src.indexOf("percorso: 'security.safeBrowse.sandbox'");
  if (i < 0) return;
  const voce = src.slice(i, src.indexOf('}),', i));
  expect(voce).not.toMatch(PROMESSA);
});
