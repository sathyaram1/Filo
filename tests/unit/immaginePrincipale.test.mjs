// L'immagine che cercano Aiuto e chat quando nessuno ne indica una (#2371): una regola sola, usata da tutte e due.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
require('../../src/shared/immaginePrincipale.js');
const IP = globalThis.SN_IMMAGINE_PRINCIPALE;
const img = (id, width, height, top = 0) => ({ id, getBoundingClientRect: () => ({ width, height, top, left: 0 }) });

test('la più grande per area, anche fuori vista; sotto i 32 pixel per lato non conta', () => {
  assert.equal(IP.scegli([img('vista', 400, 300), img('sotto', 600, 500, 3000), img('striscia', 2000, 20)]).id, 'sotto');
  assert.equal(IP.scegli([img('icona', 32, 32)]), null);
  assert.equal(IP.scegli([]), null);
});

test('l\'Aiuto sopra la pagina e la chat della home scelgono con la stessa regola', () => {
  const fonte = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  assert.match(fonte('src/content/aiutoPagina.js'), /SN_IMMAGINE_PRINCIPALE\.scegli\(/);
  assert.match(fonte('src/main/services/immagineDaCercare.js'), /SN_IMMAGINE_PRINCIPALE\.scegli\.toString\(\)/);
  for (const p of ['src/preload/page-preload.js', 'src/preload/internal-preload.js', 'src/preload/riquadri-preload.js']) {
    const s = fonte(p);
    assert.ok(s.indexOf('immaginePrincipale.js') > 0 && s.indexOf('immaginePrincipale.js') < s.indexOf('aiutoPagina.js'), p);
  }
});
