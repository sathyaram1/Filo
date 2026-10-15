// I permessi del sistema per il componente delle altre applicazioni (#779): su Mac li chiede Filo, aprendo il pannello
// giusto, e dice quale manca; su Linux riporta quello che il driver ha visto mancare; Windows non ne chiede.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = require(join(ROOT, 'src/main/services/altreApp/permessi.js'));

function electronFinto({ ax = false, schermo = 'denied' } = {}) {
  const aperti = [];
  const chiesti = [];
  return {
    aperti,
    chiesti,
    electron: () => ({
      systemPreferences: {
        isTrustedAccessibilityClient: (chiedi) => { chiesti.push(chiedi); return ax; },
        getMediaAccessStatus: (tipo) => (tipo === 'screen' ? schermo : 'granted'),
      },
      shell: { openExternal: async (u) => { aperti.push(u); } },
    }),
  };
}

test('su Mac dice quale permesso manca, e nessuno quando ci sono tutti e due', () => {
  const senza = electronFinto();
  assert.deepEqual(P.mancanti({ platform: 'darwin', electron: senza.electron }).map((m) => [m.id, m.apribile]), [['accessibilita', true], ['schermo', true]]);
  assert.deepEqual(senza.chiesti, [false], 'guardare non fa comparire la richiesta del sistema');
  assert.match(P.mancanti({ platform: 'darwin', electron: electronFinto({ ax: true }).electron })[0].frase, /Registrazione schermo/);
  assert.deepEqual(P.mancanti({ platform: 'darwin', electron: electronFinto({ ax: true, schermo: 'granted' }).electron }), []);
});

test('su Mac chiedere apre il pannello giusto (e per l\'Accessibilità fa comparire la richiesta del sistema)', async () => {
  const f = electronFinto();
  assert.deepEqual(await P.chiedi('accessibilita', { platform: 'darwin', electron: f.electron }), { ok: true });
  assert.deepEqual(await P.chiedi('schermo', { platform: 'darwin', electron: f.electron }), { ok: true });
  assert.deepEqual(f.aperti, [P.PANNELLI_MAC.accessibilita, P.PANNELLI_MAC.schermo]);
  assert.match(f.aperti[0], /Privacy_Accessibility$/);
  assert.match(f.aperti[1], /Privacy_ScreenCapture$/);
  assert.deepEqual(f.chiesti, [true]);
  assert.equal((await P.chiedi('qualunque', { platform: 'darwin', electron: f.electron })).ok, false);
  assert.equal(f.aperti.length, 2, 'un permesso sconosciuto non apre niente');
});

test('su Windows non serve niente; su Linux si riporta quello che ha visto il driver; altrove non c\'è pannello', async () => {
  assert.deepEqual(P.mancanti({ platform: 'win32' }), []);
  const l = P.mancanti({ platform: 'linux', daLinux: ['atspi', 'sconosciuto'] });
  assert.deepEqual(l.map((m) => [m.id, m.apribile]), [['atspi', false]]);
  assert.match(l[0].frase, /accessibilità del desktop/);
  assert.equal((await P.chiedi('accessibilita', { platform: 'linux' })).ok, false);
  assert.equal((await P.chiedi('accessibilita', { platform: 'win32' })).ok, false);
});
