// Esplorazione del giro 7: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots/v1433';
mkdirSync(SHOTS, { recursive: true });

async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);
async function premi(app, key, modifiers = []) {
  await app.evaluate(({ BrowserWindow }, { key, modifiers }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const t = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
  }, { key, modifiers });
}

test('i1 a riposo e raffica di Ctrl+\\', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('testo');
  await ed.screenshot({ path: `${SHOTS}/i1-riposo.png` });
  for (let i = 0; i < 7; i++) await premi(app, '\\', ['control']);
  await ed.waitForTimeout(800);
  const st = await ed.evaluate(() => ({ cls: document.documentElement.className, r: document.querySelector('.pd-pannello').getBoundingClientRect().left, iw: innerWidth }));
  console.log('I1 dopo 7 tasti', JSON.stringify(st));
  await ed.screenshot({ path: `${SHOTS}/i1-raffica.png` });
  await ed.keyboard.type('X');
  console.log('I1 testo', await ed.locator('#doc').innerText());
});

test('i2 scorciatoia di un elemento a pannello chiuso', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'pannello_app_modifica', app: 'editor', op: 'configura', id: 'italic', config: { shortcut: 'Alt+K' } }, { url: 'filo://editor/editor.html' }).catch((e) => String(e)));
  await ed.click('#doc');
  await ed.keyboard.type('alfa');
  await ed.keyboard.press('Control+A');
  await ed.keyboard.press('Alt+KeyK');
  await ed.waitForTimeout(300);
  console.log('I2', await ed.locator('#doc').innerHTML(), JSON.stringify(await app.evaluate(async () => (await globalThis.SN_STORAGE.getRaw('sn_pannelli_app', null)))));
});

test('i3 Aiuto in due schede Editor', async ({ app, openTab }) => {
  const a = await apriEditor(openTab);
  await a.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(a.locator('.sn-sidebar')).toBeVisible();
  const b = await apriEditor(openTab);
  await b.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await b.waitForTimeout(500);
  console.log('I3 B ha Aiuto', await b.locator('.sn-sidebar').count(), 'B doc', JSON.stringify(await b.evaluate(() => document.getElementById('doc').getBoundingClientRect().toJSON())));
  await b.evaluate(() => document.querySelector('.pd-striscia').click());
  await b.waitForTimeout(500);
  console.log('I3 B pannello', JSON.stringify(await b.evaluate(() => document.querySelector('.pd-pannello').getBoundingClientRect().toJSON())), 'iw', await b.evaluate(() => innerWidth));
});
