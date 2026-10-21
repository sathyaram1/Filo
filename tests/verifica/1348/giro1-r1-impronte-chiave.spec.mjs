// Verifica #1348 giro 1: un guasto che si ripete solo alle impronte (file tutti nella release) non deve aprire
// un feedback nuovo a ogni versione: la piattaforma resta rotta allo stesso modo, la chiave non deve cambiare.
import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 le impronte che falliscono a ogni versione tengono la stessa chiave', async () => {
  const m = await import(pathToFileURL(resolve(ROOT, 'scripts', 'release-platform-alarm.mjs')).href);
  const R = (tag) => ({ tag, bozza: false, anteprima: false, allegati: [...m.PIATTAFORME.Mac.attesi] });
  // 0.2.300 uscita per intero; dalla 301 in poi i file arrivano tutti ma le impronte si fermano ogni volta.
  const storia = [R('v0.2.300'), R('v0.2.301'), R('v0.2.302'), R('v0.2.303')];
  const esiti = { build: { outcome: 'success' }, controllo: { outcome: 'success' }, impronte: { outcome: 'failure' } };
  const chiavi = ['v0.2.301', 'v0.2.302', 'v0.2.303'].map((versione) => m.chiaviAllarme('Mac', {
    versione, rilasci: storia, passo: 'impronte', esiti, pagina: m.paginaDellaVersione(storia, versione),
  }).join(','));
  expect(new Set(chiavi).size, `chiavi: ${chiavi.join(' | ')}`).toBe(1);
});
