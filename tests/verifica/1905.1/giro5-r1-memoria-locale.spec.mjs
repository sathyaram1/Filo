// Verifica #1905.1 giro 5, rilievo 1: una pagina del computer che ricorda qualcosa nella memoria locale, come in un
// browser, non riceve un errore di sicurezza e il suo script non si ferma.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const schedaFile = (app, fine) => app.evaluate(({ BrowserWindow }, fine) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { const u = x.view.webContents.getURL() || x.url; return /^file:/.test(u) && u.endsWith(fine); } catch (_) { return false; } });
  return t ? t.id : null;
}, fine);
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('r1 una lista della spesa salvata sul computer ricorda il tema con la memoria locale e disegna la lista', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('memoria-'), 'Documenti');
  mkdirSync(dir, { recursive: true });
  // Come tante pagine fatte a mano o salvate: legge il tema senza try, poi disegna.
  writeFileSync(join(dir, 'spesa.html'), `<!doctype html><meta charset="utf-8"><title>Spesa</title><body><ul id="l"></ul><script>
const tema = localStorage.getItem('tema') || 'chiaro';
localStorage.setItem('tema', tema);
sessionStorage.setItem('aperta', '1');
document.body.dataset.tema = tema;
for (const x of ['pane', 'latte']) { const li = document.createElement('li'); li.textContent = x; document.getElementById('l').appendChild(li); }
</script></body>`);
  await home(app);
  const file = join(dir, 'spesa.html');
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'spesa.html')), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  await expect(pagina).toHaveTitle('Spesa', { timeout: 10_000 });
  await expect(pagina.locator('#l li'), 'lo script arriva in fondo e la lista si vede').toHaveText(['pane', 'latte'], { timeout: 10_000 });
  expect(await pagina.locator('body').getAttribute('data-tema')).toBe('chiaro');
});
