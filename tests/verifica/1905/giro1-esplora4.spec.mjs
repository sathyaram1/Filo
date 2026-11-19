// Verifica #1905 giro 1: il riquadro di conferma quando il percorso lo ha trovato Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmText } from '../../helpers/confirm.mjs';
import { cartellaInCasa, togliCartella } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let base; let file;
test.beforeEach(() => {
  base = cartellaInCasa('filo-1905d-');
  mkdirSync(join(base, 'Desktop'), { recursive: true });
  file = join(base, 'Desktop', 'report.html');
  writeFileSync(file, '<!doctype html><title>R</title>x');
});
test.afterEach(() => { try { togliCartella(base); } catch (_) {} });

test('chiesto a parole senza il percorso: il riquadro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, 'aprimi il report html che sta sul desktop');
  await page.waitForTimeout(3000);
  console.log('riquadro', (await page.locator(CONFIRM_HOST).count()), JSON.stringify(await confirmText(page)));
});

test('percorso scritto dall\'utente, dopo una ricerca nello stesso compito', async ({ app }) => {
  const r = await app.evaluate((_e, [u, p]) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: u },
    { parole: `cerca come si fa un riquadro e poi apri ${p}`, contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }] }), [pathToFileURL(file).href, file]);
  console.log('scritto+sporco', JSON.stringify(r));
});
