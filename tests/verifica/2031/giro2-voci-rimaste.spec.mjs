// #2031 giro 2 — le porte del giro 1 ri-provate: senza la finestra principale ogni voce che agisce su finestra o pagina
// la ridà con le sue schede.

import { test, expect } from '../../fixtures/electron.mjs';
import { voceDellaBarra } from '../../helpers/barraDeiMenu.mjs';

const normale = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  if (!w) return null;
  return { visibile: w.isVisible(), schede: w._filoTabs.tabs.map((t) => t.url || '') };
});

const voci = ['Avanti', 'Rimpicciolisci', 'Dimensione reale', 'Pannello degli strumenti', 'Tieni aperta o sblocca la barra laterale',
  'Quaderno delle memorie', 'Novità', 'Preferenze', 'Opzioni', 'Crediti e inviti'];
for (const voce of voci) {
  test(`senza la finestra principale, «${voce}» la ridà con le sue schede`, async ({ app, shell, openTab, testServer }) => {
    const accesso = `${testServer.html('<title>Accedi</title>')}?client_id=1&redirect_uri=x`;
    const page = await testServer.openReady(openTab, `<title>Negozio</title><button id="b" style="width:200px;height:50px"
      onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')},'login','width=420,height=520')">A</button>`);
    const negozio = page.url();
    await page.click('#b');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w._filoTabs).length), { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => app.evaluate(async () => ((await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null))?.tabs) || []), { timeout: 10000 }).toContain(negozio);
    await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
    await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();
    await voceDellaBarra(app, voce);
    await expect.poll(async () => (await normale(app))?.schede || [], { message: `«${voce}» non ha ridato la finestra`, timeout: 15000 }).toContain(negozio);
    expect((await normale(app)).visibile).toBe(true);
  });
}
