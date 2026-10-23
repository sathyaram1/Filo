// Verifica #1433, giro 2: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots';

async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-elemento[data-elemento="word-count"]') && document.documentElement.dataset.filoContentScripts === '1');
  return ed;
}
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));
const esegui = (app, a) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), a);
const aiuto = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));

async function riempi(ed) {
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = Array.from({ length: 14 }, (_, i) => `<p>Riga ${i} di testo abbastanza lunga da arrivare fino al bordo destro della colonna centrale del foglio, e anche oltre.</p>`).join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab }) => {
    mkdirSync(SHOTS, { recursive: true });
    const ed = await apriEditor(openTab);
    await ed.evaluate((t) => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }), tema);
    await ed.waitForTimeout(600);
    await riempi(ed);
    await ed.screenshot({ path: `${SHOTS}/v1433-${tema}-chiuso.png` });
    await ed.evaluate(() => document.querySelector('.pd-striscia').click());
    await ed.waitForTimeout(500);
    await ed.screenshot({ path: `${SHOTS}/v1433-${tema}-aperto.png` });
    await ed.click('.pd-lucchetto');
    await ed.waitForTimeout(400);
    await ed.screenshot({ path: `${SHOTS}/v1433-${tema}-bloccato.png` });
    await ed.click('.pd-piu');
    await ed.waitForTimeout(400);
    await ed.screenshot({ path: `${SHOTS}/v1433-${tema}-espanso.png` });
    for (const id of ['text-size', 'align', 'font', 'undo', 'redo', 'settings', 'bold', 'italic', 'underline']) await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: id });
    await ed.click('.pd-piu');
    await ed.waitForTimeout(400);
    await ed.screenshot({ path: `${SHOTS}/v1433-${tema}-tutti.png` });
    await aiuto(app);
    await ed.waitForTimeout(800);
    await ed.screenshot({ path: `${SHOTS}/v1433-${tema}-tutti-aiuto.png` });
  });
}

test('finestra stretta, bloccato con Aiuto', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await riempi(ed);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito); w.unmaximize(); w.setSize(960, 720); });
  await ed.waitForTimeout(800);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.click('.pd-lucchetto');
  await aiuto(app);
  await ed.waitForTimeout(1000);
  mkdirSync(SHOTS, { recursive: true });
  await ed.screenshot({ path: `${SHOTS}/v1433-stretta.png` });
  const m = await ed.evaluate(() => ({
    w: window.innerWidth,
    doc: document.getElementById('doc').getBoundingClientRect().toJSON(),
    pannello: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(),
    aiuto: document.querySelector('.sn-sidebar').getBoundingClientRect().toJSON(),
  }));
  console.log('STRETTA', JSON.stringify(m));
});

test('sbloccato con Aiuto: il pannello sta alla sua sinistra', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await aiuto(app);
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(500);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(500);
  const m = await ed.evaluate(() => ({
    pannello: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(),
    aiuto: document.querySelector('.sn-sidebar').getBoundingClientRect().toJSON(),
    striscia: document.querySelector('.pd-striscia').getBoundingClientRect().toJSON(),
  }));
  console.log('SBLOCCATO-AIUTO', JSON.stringify(m));
  await ed.screenshot({ path: `${SHOTS}/v1433-sbloccato-aiuto.png` });
  // clic fuori: l'Aiuto si riduce alla casella; il pannello?
  await ed.mouse.click(300, 400);
  await ed.waitForTimeout(600);
  await ed.screenshot({ path: `${SHOTS}/v1433-aiuto-ridotto.png` });
  const n = await ed.evaluate(() => ({
    aperto: document.documentElement.classList.contains('pd-aperto'),
    aiuto: document.querySelector('.sn-sidebar')?.getBoundingClientRect().toJSON(),
    cls: document.querySelector('.sn-sidebar')?.className,
  }));
  console.log('RIDOTTO', JSON.stringify(n));
  // riapro il pannello con l'Aiuto ridotto
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: `${SHOTS}/v1433-aiuto-ridotto-pannello.png` });
  const k = await ed.evaluate(() => ({
    pannello: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(),
    aiuto: document.querySelector('.sn-sidebar')?.getBoundingClientRect().toJSON(),
  }));
  console.log('RIDOTTO-PANNELLO', JSON.stringify(k));
});

test('strumenti aggiunti funzionano', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  for (const id of ['align', 'undo', 'redo', 'text-size']) await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: id });
  await expect.poll(() => elementi(ed)).toEqual(['word-count', 'search-replace', 'comment', 'align', 'undo', 'redo', 'text-size']);
  await ed.click('#doc');
  await ed.keyboard.type('prova di testo');
  await ed.waitForTimeout(400);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(300);
  const html = await ed.evaluate(() => ({ align: document.querySelector('.pd-elemento[data-elemento="align"]').innerHTML.slice(0, 600), ts: document.querySelector('.pd-elemento[data-elemento="text-size"]').innerHTML.slice(0, 600) }));
  console.log('HTML', JSON.stringify(html));
  // undo
  await ed.locator('.pd-elemento[data-elemento="undo"] .ed-fmt-btn').dispatchEvent('mousedown', { button: 0 });
  await ed.waitForTimeout(300);
  console.log('DOPO-UNDO', await ed.locator('#doc').innerText());
  await ed.locator('.pd-elemento[data-elemento="redo"] .ed-fmt-btn').dispatchEvent('mousedown', { button: 0 });
  await ed.waitForTimeout(300);
  console.log('DOPO-REDO', await ed.locator('#doc').innerText());
});

test('pagina web: il pannello a parole non si apre', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, '<html><body style="height:3000px">ciao</body></html>');
  const r = await esegui(app, { type: 'PANNELLO_APP', operazione: 'apri' });
  console.log('WEB', JSON.stringify(r));
  const pd = await p.evaluate(() => !!document.querySelector('.pd-pannello'));
  expect(pd).toBe(false);
});

test('migrazione: due documenti, nessuno si perde', async ({ openTab }) => {
  const ed0 = await openTab(EDITOR);
  await ed0.waitForSelector('#doc');
  await ed0.evaluate(() => {
    const f = (id, t, mods) => ({ id, meta: { title: t, created: '2026-01-01T00:00:00Z', modified: '2026-01-02T00:00:00Z', version: 1, grid: { cols: 7, rows: 10 } },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `testo ${t}` }] }] }, comments: [], modules: mods });
    localStorage.setItem('filo.editor.collection', JSON.stringify({
      version: 2, activeId: 'f1',
      files: [
        f('f1', 'Uno', [{ id: 'm1', type: 'word-count', cells: [{ x: 0, y: 0, z: 0 }], data: { count: 'chars' } }]),
        f('f2', 'Due', [{ id: 'm2', type: 'italic', cells: [{ x: 0, y: 0, z: 0 }], data: { shortcut: 'Ctrl+J' } }, { id: 'm3', type: 'chat', cells: [{ x: 1, y: 0, z: 1 }], data: { messages: [{ role: 'user', text: 'ciao' }] } }]),
      ],
    }));
  });
  await ed0.reload();
  await ed0.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await ed0.waitForTimeout(800);
  const s = await ed0.evaluate(() => JSON.parse(localStorage.getItem('filo.editor.collection')));
  console.log('COLL', JSON.stringify(s).slice(0, 1500));
  console.log('ELEMENTI', JSON.stringify(await elementi(ed0)));
});
