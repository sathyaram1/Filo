// Gli spec lanciati dagli script nel contenitore senza schermo: xvfb davanti da solo, o uno stop
// che dice cosa manca. E, nello stesso strumento, gli spec del lato arrivato da main al riallineamento.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparaLancioElectron, senzaSchermo } from '../../scripts/lib/schermo-virtuale.mjs';
import { shaDelRiallineamento } from '../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mai = () => { throw new Error('xvfb cercato dove non serve'); };

test('su Windows, Mac e Linux con schermo il comando resta com\'è', () => {
  for (const [platform, env] of [['win32', {}], ['darwin', {}], ['linux', { DISPLAY: ':0' }], ['linux', { WAYLAND_DISPLAY: 'wayland-0' }]]) {
    const l = preparaLancioElectron('npx', ['playwright', 'test', 'tests/a.spec.mjs'], { platform, env, haXvfb: mai });
    assert.deepEqual([l.ok, l.cmd, l.args, l.env, l.nota], [true, 'npx', ['playwright', 'test', 'tests/a.spec.mjs'], undefined, ''], platform);
  }
});

test('Linux senza schermo con xvfb: xvfb-run -a davanti e la sandbox spenta', () => {
  const l = preparaLancioElectron('npx', ['playwright', 'test', 'tests/a.spec.mjs'], { platform: 'linux', env: { PATH: '/bin' }, haXvfb: () => true });
  assert.equal(l.ok, true);
  assert.equal(l.cmd, 'xvfb-run');
  assert.deepEqual(l.args, ['-a', 'npx', 'playwright', 'test', 'tests/a.spec.mjs']);
  assert.equal(l.env.ELECTRON_DISABLE_SANDBOX, '1');
  assert.equal(l.env.PATH, '/bin', 'il resto dell\'ambiente passa intatto');
  assert.match(l.nota, /xvfb-run -a/);
});

test('Linux senza schermo e senza xvfb: si ferma e dice cosa manca', () => {
  const l = preparaLancioElectron('npx', [], { platform: 'linux', env: { DISPLAY: '  ' }, haXvfb: () => false });
  assert.equal(l.ok, false);
  assert.match(l.motivo, /xvfb-run non c'è/);
  assert.match(l.motivo, /apt-get install -y xvfb/);
});

test('senzaSchermo guarda solo Linux', () => {
  assert.equal(senzaSchermo({ platform: 'linux', env: {} }), true);
  assert.equal(senzaSchermo({ platform: 'win32', env: {} }), false);
});

test('finish-local lancia gli spec passando dal lancio preparato, e controlla prima degli unit test', () => {
  const src = readFileSync(resolve(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
  assert.doesNotMatch(src, /run\(\s*'npx'\s*,\s*\[\s*'playwright'/, 'un npx playwright lanciato a mano salta xvfb');
  assert.match(src, /preparaLancioElectron\('npx', \['playwright', 'test'/);
  const controllo = src.indexOf("preparaLancioElectron('npx', [])");
  const unit = src.indexOf("run('npm', ['run', 'test:unit']");
  assert.ok(controllo > 0 && controllo < unit, 'senza xvfb ci si ferma prima degli unit test, non dopo');
});

test('riallineamento: il commit verificato arriva dal marcatore di chi verifica, e da nessun altro', () => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  assert.equal(shaDelRiallineamento({ role: 'verifier', dal: sha }), sha);
  assert.equal(shaDelRiallineamento({ role: 'verifier' }), '');
  assert.equal(shaDelRiallineamento({ role: 'prober', dal: sha }), '', 'solo un verificatore è in un giro di riallineamento');
  assert.equal(shaDelRiallineamento({ role: 'verifier', dal: 'HEAD; rm -rf /' }), '', 'solo esadecimale');
  assert.equal(shaDelRiallineamento(null), '');
});

test('riallineamento: finish-local aggiunge i file cambiati dal commit verificato', () => {
  const src = readFileSync(resolve(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
  assert.match(src, /shaDelRiallineamento\(readMarker\(ROOT\)\)/);
  assert.match(src, /\['diff', '--name-only', sha, 'HEAD'\]/);
});
