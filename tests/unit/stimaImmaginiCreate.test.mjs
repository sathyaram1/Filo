// #2272 — la stima accanto a «Immagini create in chat»: i token dell'immagine al prezzo delle immagini, la media
// dell'utente non vale per questa voce, e il listino legge anche i modelli che producono solo immagini.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['constants', 'i18n', 'modelUsage', 'modelChainEditor', 'contenutoEsterno', 'preferences', 'wallet', 'stimaCosto']) {
  require(join(ROOT, 'src', 'shared', `${m}.js`));
}
const S = globalThis.SN_STIMA_COSTO;
const { ACTIONS: A } = globalThis.SN_CONST;

// Come li manda OpenRouter: dollari per token, l'uscita in immagini a parte.
const PITTORE = { id: 'prova/pittore', pricing: { prompt: '0.0000003', completion: '0.0000025', image_output: '0.00003' } };

test('un\'immagine creata costa circa 4 centesimi: i suoi token al prezzo delle immagini', () => {
  const l = S.listinoDaCatalogo([PITTORE]);
  assert.equal(l['prova/pittore'].immagineUscita, 0.00003);
  const t = S.tokenTipici(A.IMAGE_GEN, {});
  assert.equal(t.immagini, 1300);
  const usd = S.costoUsd(l['prova/pittore'], t);
  assert.ok(usd > 0.035 && usd < 0.045, `costo di un'immagine: ${usd}`);
});

test('la media dei token dell\'utente non sostituisce la stima di un\'immagine creata', () => {
  const registro = { [A.IMAGE_GEN]: { n: 500, prompt: 30, completion: 20, cached: 0 } };
  const t = S.tokenTipici(A.IMAGE_GEN, registro);
  assert.equal(t.fonte, 'prudente');
  assert.equal(t.immagini, 1300);
  // Per le altre voci la media dell'utente vale ancora.
  assert.equal(S.tokenTipici(A.FILO_CHAT, { [A.FILO_CHAT]: { n: 500, prompt: 30, completion: 20, cached: 0 } }).fonte, 'registro');
});

test('senza un prezzo per le immagini i loro token valgono come l\'uscita di testo', () => {
  const l = S.listinoDaCatalogo([{ id: 'prova/vecchio', pricing: { prompt: '0.0000003', completion: '0.0000025' } }]);
  const usd = S.costoUsd(l['prova/vecchio'], S.tokenTipici(A.IMAGE_GEN, {}));
  assert.ok(Math.abs(usd - (400 * 0.0000003 + 1400 * 0.0000025)) < 1e-9, String(usd));
});

test('il listino legge anche la lista dei modelli che producono solo immagini', async () => {
  const CM = require(join(ROOT, 'src', 'main', 'services', 'costoModelli.js'));
  const chieste = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    chieste.push(String(url));
    const data = /output_modalities=image/.test(String(url)) ? [PITTORE] : [];
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  try {
    const l = await CM.listino({ forza: true });
    assert.ok(chieste.some((u) => /output_modalities=image\b/.test(u)), chieste.join('\n'));
    assert.equal(l['prova/pittore'].immagineUscita, 0.00003);
  } finally { globalThis.fetch = orig; }
});
