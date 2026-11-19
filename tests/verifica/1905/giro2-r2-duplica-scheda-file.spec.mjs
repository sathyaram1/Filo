// Verifica #1905 giro 2, rilievo 2: «Duplica» dal tasto destro della linguetta copia anche la scheda di un file del computer.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa, togliCartella } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { let titolo = ''; try { titolo = t.view.webContents.getTitle(); } catch (_) {} return { id: t.id, titolo }; });
});

let base;
test.afterEach(() => { try { togliCartella(base); } catch (_) {} });

test('r2 duplicata, la scheda di un file aperto dall\'utente ha la sua copia con la stessa pagina', async ({ app, shell }) => {
  test.setTimeout(60_000);
  base = cartellaInCasa('filo-1905-r2-');
  const dir = join(base, 'Desktop');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'riquadro.html');
  writeFileSync(file, '<!doctype html><title>Riquadro</title><h1>ciao</h1>');
  await home(app);
  const r = await app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action: { type: 'NAVIGA', url: file }, opts: { parole: `apri ${file}` } });
  expect(r.executed).toBe(true);
  let s;
  await expect.poll(async () => { s = (await schede(app)).find((x) => x.titolo === 'Riquadro'); return !!s; }, { timeout: 10_000 }).toBe(true);
  // La voce «Duplica» del menu della linguetta passa da qui.
  const copia = await shell.evaluate((id) => window.filoShell.tabs.duplicate(id), s.id);
  expect(copia.ok, 'la copia si apre').toBe(true);
  await expect.poll(async () => (await schede(app)).filter((x) => x.titolo === 'Riquadro').length, { timeout: 10_000 }).toBe(2);
});
