// #946 giro 5: un'immagine AVIF/HEIF con credenziali C2PA scritte come dice lo standard
// (box uuid con versione, flag, «manifest» e l'offset prima del JUMBF): il menu deve parlarne.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');
// Un AVIF vero di 64×64 (ffmpeg, libaom): il browser lo disegna.
const AVIF = Buffer.from('AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAdAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAABAAAAAQAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAlbWRhdAoGGBV//bAIMhMYAAAAUAAAAAoBn7+o0NWD4eQo', 'base64');

function jumbfDelPng() {
  const png = readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.png'));
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    if (png.toString('latin1', i + 4, i + 8) === 'caBX') return png.subarray(i + 8, i + 8 + len);
    i += 12 + len;
  }
  throw new Error('caBX assente');
}

function box(tipo, corpo) {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + corpo.length);
  h.write(tipo, 4, 'latin1');
  return Buffer.concat([h, corpo]);
}

test('AVIF con credenziali C2PA nella forma dello standard: il menu ne parla', async ({ openTab, testServer }) => {
  const uuid = Buffer.from('d8fec3d61b0e483c92975828877ec481', 'hex');
  // In coda al file: gli offset assoluti dell'immagine restano validi.
  const c2pa = box('uuid', Buffer.concat([uuid, Buffer.alloc(4), Buffer.from('manifest\u0000', 'latin1'), Buffer.alloc(8), jumbfDelPng()]));
  const src = testServer.asset(Buffer.concat([AVIF, c2pa]), 'image/avif');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="160" height="160"></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').naturalWidth > 0, null, { timeout: 10000 });
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = page.locator('.sn-menu');
  await expect(menu.locator('.sn-menu-link-body')).toBeVisible({ timeout: 10000 });
  await expect(menu.locator('.sn-menu-origine'), 'le credenziali nell’AVIF non sono state lette').toBeVisible({ timeout: 10000 });
});
