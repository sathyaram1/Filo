// #1905 giro 3, rilievo 2: un percorso passato con le virgolette con cui lo copia Esplora risorse («Copia come
// percorso») apre il file; non diventa una ricerca sul web col percorso dell'utente dentro.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => ({ url: t.url || '', title: t.view.webContents.getTitle() }));
});

test.beforeEach(async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoPronta);
});

for (const [nome, cita] of [['virgolette doppie', (p) => `"${p}"`], ['virgolette semplici', (p) => `'${p}'`]]) {
  test(`r2 percorso fra ${nome}: si apre il file, nessuna ricerca sul web`, async ({ app }) => {
    const dir = cartellaInCasa('filo-1905 virgolette');
    const html = join(dir, 'riquadro conferma.html');
    writeFileSync(html, '<title>Riquadro conferma</title><h1>resa</h1>');
    const citato = cita(html);
    await execAction(app, { type: 'NAVIGA', url: citato }, { parole: [`aprimi ${citato}`] });
    await expect.poll(async () => (await schede(app)).map((s) => s.title), { timeout: 8000, message: 'il file non si è aperto' }).toContain('Riquadro conferma');
    expect((await schede(app)).some((s) => /search\?|[?&]q=/.test(s.url)), 'il percorso è finito in una ricerca sul web').toBe(false);
  });
}
