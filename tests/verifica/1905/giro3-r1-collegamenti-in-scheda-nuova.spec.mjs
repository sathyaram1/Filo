// #1905 giro 3, rilievo 1: da un file aperto, un collegamento a un altro file della stessa cartella si apre anche in una
// scheda nuova (target=_blank, Ctrl+clic, clic centrale, window.open), come col clic semplice nella stessa scheda.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const titoli = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => t.view.webContents.getTitle());
});
const clicVero = (app, sel, { button = 'left', modifiers = [] } = {}) => app.evaluate(async ({ BrowserWindow }, { sel, button, modifiers }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const wc = tm.tabs.find((x) => (x.view.webContents.getURL() || '').endsWith('/indice.html')).view.webContents;
  const r = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(b.x + 3), y: Math.round(b.y + 3) }; })()`);
  wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button, clickCount: 1, modifiers });
  wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button, clickCount: 1, modifiers });
}, { sel, button, modifiers });

test.beforeEach(async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoPronta);
});

for (const [nome, sel, opzioni] of [
  ['collegamento con target=_blank', '#blank', {}],
  ['Ctrl+clic', '#plain', { modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] }],
  ['clic centrale', '#plain', { button: 'middle' }],
  ['window.open dalla pagina', '#wo', {}],
]) {
  test(`r1 ${nome}: il file accanto si apre in una scheda nuova`, async ({ app }) => {
    const dir = cartellaInCasa('filo-1905 indice');
    const indice = join(dir, 'indice.html');
    writeFileSync(indice, '<title>Indice</title><p><a id="blank" target="_blank" href="capitolo.html">capitolo</a></p>'
      + '<p><a id="plain" href="capitolo.html">capitolo</a></p><p><button id="wo" onclick="window.open(\'capitolo.html\')">capitolo</button></p>');
    writeFileSync(join(dir, 'capitolo.html'), '<title>Capitolo uno</title><p>testo del capitolo</p>');
    const r = await execAction(app, { type: 'NAVIGA', url: indice }, { parole: [`apri ${indice}`] });
    expect(r.executed).toBe(true);
    await expect.poll(() => titoli(app), { timeout: 8000 }).toContain('Indice');
    await clicVero(app, sel, opzioni);
    await expect.poll(() => titoli(app), { timeout: 8000, message: 'il capitolo accanto non si è aperto in una scheda' }).toContain('Capitolo uno');
    expect(await titoli(app), 'l\'indice resta dov\'era').toContain('Indice');
  });
}
