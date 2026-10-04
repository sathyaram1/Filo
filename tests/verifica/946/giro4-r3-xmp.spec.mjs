// #946 giro 4: l'etichetta «Digital Source Type» scritta in XMP valido con gli apici
// semplici fa comparire la riga come quella con le virgolette.

import { test, expect } from '../../fixtures/electron.mjs';
import { pngSpoglio, pngConXmp } from '../../helpers/immagineFirmata.mjs';

const U = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';
const XMP = `<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>`
  + `<rdf:Description rdf:about='' xmlns:Iptc4xmpExt='http://iptc.org/std/Iptc4xmpExt/2008-02-29/' Iptc4xmpExt:DigitalSourceType='${U}'/>`
  + `</rdf:RDF></x:xmpmeta>`;

test('XMP con gli apici semplici: la riga compare', async ({ openTab, testServer }) => {
  const src = testServer.asset(pngConXmp(pngSpoglio(), XMP), 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="160" height="160"></body></html>`);
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(page.locator('.sn-menu .sn-menu-origine')).toHaveAttribute('aria-label', /Generata con l’AI/, { timeout: 10000 });
});
