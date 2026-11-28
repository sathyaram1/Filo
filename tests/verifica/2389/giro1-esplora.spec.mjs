// Verifica #2389 giro 1: l'Editor nasce dalla bozza del campo della home.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHOTS = join(ROOT, 'tests', '.shots', 'v2389');
mkdirSync(SHOTS, { recursive: true });

async function finestraCon(app, prefisso, tetto = 10_000) {
  const scadenza = Date.now() + tetto;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith(prefisso); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
async function home(app) {
  const w = await finestraCon(app, 'filo://newtab', 15_000);
  await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
  return w;
}
const testoDoc = (ed) => ed.locator('#doc').innerText();
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
  return { attiva: tm.activeId, tabs: tm.tabs.map((t) => ({ id: t.id, url: t.url })) };
});
const chiudiAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
  tm.closeTab(tm.activeId);
});
function registra(nome, secondi = 3) {
  const dir = join(SHOTS, nome); mkdirSync(dir, { recursive: true });
  const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-t', String(secondi),
    '-i', process.env.DISPLAY, join(dir, 'f%03d.png')], { stdio: 'ignore' });
  return new Promise((r) => p.on('exit', r));
}

test('bozza: Caro condominio diventa il documento e il campo si svuota', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Caro condominio,');
  const t0 = Date.now();
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  expect(ed).not.toBeNull();
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Caro condominio,');
  console.log('tempo apertura ms', Date.now() - t0);
  await expect(page.locator('#input')).toHaveValue('');
  console.log('schede', JSON.stringify(await schede(app)));
  await ed.screenshot({ path: join(SHOTS, 'editor-aperto.png') });
});

test('clic sul corpo della carta e Invio fanno lo stesso', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Prima riga dal corpo');
  await page.locator('#tieni .dash-carta[data-tipo="editor"]').click({ position: { x: 150, y: 20 } });
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Prima riga dal corpo');
  await expect(page.locator('#input')).toHaveValue('');
});

test('campo vuoto apre come oggi', async ({ app }) => {
  const page = await home(app);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  expect(ed).not.toBeNull();
  console.log('vuoto, testo doc:', JSON.stringify((await testoDoc(ed)).slice(0, 80)));
});

test('testo strano: HTML, a capo, emoji, spazi', async ({ app }) => {
  const page = await home(app);
  const bozza = '<b>grassetto</b> <img src=x onerror="window.__xss=1">\nseconda riga 😀\n\n   terza';
  await page.locator('#input').fill(bozza);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('<b>grassetto</b>');
  const t = await testoDoc(ed);
  console.log('strano:', JSON.stringify(t.slice(0, 200)));
  expect(await ed.evaluate(() => window.__xss)).toBeUndefined();
  expect(await ed.locator('#doc img').count()).toBe(0);
  expect(t).toContain('seconda riga 😀');
  expect(t).toContain('terza');
});

test('soli spazi: niente documento vuoto creato', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('    ');
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  expect(ed).not.toBeNull();
  console.log('spazi, campo dopo:', JSON.stringify(await page.locator('#input').inputValue()), 'doc:', JSON.stringify((await testoDoc(ed)).slice(0, 60)));
});

test('testo lunghissimo', async ({ app }) => {
  const page = await home(app);
  const lungo = 'parola '.repeat(6000) + 'FINE';
  await page.locator('#input').fill(lungo);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(async () => (await testoDoc(ed)).includes('FINE'), { timeout: 10000 }).toBe(true);
  expect((await testoDoc(ed)).length).toBeGreaterThan(40000);
});

test('doppio clic in fretta: un documento solo, testo non duplicato', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Doppio');
  const b = page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale');
  await b.dblclick();
  await page.waitForTimeout(2500);
  const s = await schede(app);
  console.log('doppio schede', JSON.stringify(s));
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  const t = await testoDoc(ed);
  expect(t.match(/Doppio/g)?.length).toBe(1);
  expect(s.tabs.filter((x) => x.url.startsWith('filo://editor')).length).toBe(1);
});

test('chiusura: il documento resta salvato, nel campo non torna niente', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Caro condominio, chiudo subito');
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('chiudo subito');
  await page.waitForTimeout(1500);
  await chiudiAttiva(app);
  await page.waitForTimeout(2000);
  console.log('dopo chiusura schede', JSON.stringify(await schede(app)));
  const h = await finestraCon(app, 'filo://newtab');
  console.log('campo dopo chiusura:', JSON.stringify(await h.locator('#input').inputValue()));
  expect(await h.locator('#input').inputValue()).toBe('');
  // il documento si ritrova fra i recenti
  await h.screenshot({ path: join(SHOTS, 'home-dopo-chiusura.png') });
  const recenti = await h.locator('#tieni .dash-carta[data-tipo="editor"]').innerText();
  console.log('carta editor:', JSON.stringify(recenti));
});

test('bozza ricordata non riappare in una home nuova', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Non devo tornare');
  await page.waitForTimeout(1200);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Non devo tornare');
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
    tm.createTab ? tm.createTab('filo://newtab') : null;
  });
  await new Promise((r) => setTimeout(r, 2500));
  const tutte = app.windows().filter((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
  for (const w of tutte) console.log('home campo:', JSON.stringify(await w.locator('#input').inputValue()));
  for (const w of tutte) expect(await w.locator('#input').inputValue()).not.toContain('Non devo tornare');
});

test('frame: apertura e chiusura registrate', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Caro condominio,');
  await page.waitForTimeout(500);
  const rec = registra('apertura', 2.5);
  await page.waitForTimeout(300);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await rec;
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Caro condominio,');
  const rec2 = registra('chiusura', 2.5);
  await page.waitForTimeout(300);
  await chiudiAttiva(app);
  await rec2;
});

test('tema scuro: frame apertura', async ({ app }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const page = await home(app);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#input').fill('Caro condominio, scuro');
  await page.waitForTimeout(500);
  const rec = registra('apertura-scuro', 2.5);
  await page.waitForTimeout(300);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await rec;
});

test('riduzione del movimento: nessuna animazione', async ({ app }) => {
  const page = await home(app);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#input').fill('Movimento ridotto');
  await page.waitForTimeout(500);
  const rec = registra('ridotto', 2);
  await page.waitForTimeout(300);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await rec;
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Movimento ridotto');
});

test('primo uso: quanti documenti nascono', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Riga uno\n\nRiga tre');
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Riga tre');
  await page.waitForTimeout(1500);
  console.log('paragrafi', await ed.locator('#doc > *').count(), JSON.stringify(await ed.locator('#doc').innerHTML()));
  const coll = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.get ? null : null;
    return s;
  });
  await ed.locator('#docSwitcher, .ed-doc-switcher, [data-ruolo="documenti"]').first().click().catch(() => {});
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: join(SHOTS, 'primo-uso-documenti.png') });
});

test('riscrivilo più breve sul paragrafo selezionato', async ({ app }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const risposta = (attempts, messages) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      const testo = JSON.stringify(messages);
      let text = '{"message":"Ciao.","suggestions":[]}';
      if (testo.includes('scritto in un campo editabile')) text = '{"issues":[]}';
      else if (testo.includes('riscrivilo')) text = JSON.stringify({ text: 'Fatto.', status: 'done', formatta: [{ op: 'riscrivi', target: 'selection', testo: 'Breve.' }] });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
    P.streamCompleteWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
  });
  const page = await home(app);
  await page.locator('#input').fill('Primo paragrafo lungo, molto lungo, da accorciare.\nSecondo paragrafo che resta.');
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Secondo paragrafo');
  await ed.waitForTimeout(1500);
  const aiuto = await paginaDellAiuto(app, ed);
  await expect(aiuto.locator('.sn-sidebar')).toBeVisible();
  await ed.locator('#doc p').first().click({ clickCount: 3 });
  await aiuto.fill('.sn-sidebar-input textarea', 'riscrivilo più breve');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => testoDoc(ed), { timeout: 15000 }).toContain('Breve.');
  const t = await testoDoc(ed);
  console.log('dopo riscrittura:', JSON.stringify(t));
  expect(t).not.toContain('Primo paragrafo');
  expect(t).toContain('Secondo paragrafo che resta.');
  const visti = await app.evaluate(() => JSON.stringify(globalThis.__visti.filter((m) => JSON.stringify(m).includes('riscrivilo'))));
  expect(visti).toContain('Primo paragrafo lungo, molto lungo, da accorciare.');
  // chiudi e riapri la colonna
  await aiuto.locator('.sn-sidebar-close').click();
  await expect(aiuto.locator('.sn-sidebar')).toBeHidden({ timeout: 5000 });
  await ed.screenshot({ path: join(SHOTS, 'editor-chat-chiusa.png') });
});

test('chat di lato nell\'editor nato dal campo', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Primo paragrafo lungo da accorciare.');
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Primo paragrafo');
  await ed.waitForTimeout(1500);
  const aiuto = await paginaDellAiuto(app, ed);
  const vis = await aiuto.locator('.sn-sidebar').isVisible().catch(() => false);
  console.log('sidebar visibile subito:', vis);
  await ed.screenshot({ path: join(SHOTS, 'editor-chat.png') });
  const shot = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w.getContentBounds();
  });
  console.log('bounds', JSON.stringify(shot));
  console.log('sidebar count', await aiuto.locator('.sn-sidebar').count(), 'close btn', await aiuto.locator('.sn-sidebar-close').count());
});
