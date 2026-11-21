// Esplorazione del giro 4 di #1905: tipi di file, barra degli indirizzi, lettura della scheda, aspetto della conferma.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const FOTO = join(process.cwd(), 'tests', 'fixtures', 'provenienza', 'c2pa-ufficiale-ai.png');
const SHOTS = join(process.cwd(), 'tests', '.shots');
const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, { src, arg }) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', `return (${src})(tm, arg);`)(t, arg);
}, { src: fn.toString(), arg });
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('tipi di file', async ({ app }) => {
  test.setTimeout(120_000);
  const dir = join(cartellaTemporanea('g4t-'), 'tipi');
  mkdirSync(dir, { recursive: true });
  const file = {
    'a.txt': 'testo semplice', 'b.md': '# Titolo\n\ntesto', 'c.json': '{"a":1}', 'd.csv': 'a,b\n1,2', 'e.log': 'riga',
    'f.xml': '<?xml version="1.0"?><r>x</r>', 'g.htm': '<title>htm</title>', 'h.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>xh</title></head><body>x</body></html>',
  };
  for (const [n, c] of Object.entries(file)) writeFileSync(join(dir, n), c);
  for (const n of ['i.jpg', 'j.webp', 'k.gif', 'l.mp4', 'm.mp3', 'n.webm', 'o.wav', 'p.ico', 'q.bmp']) copyFileSync(FOTO, join(dir, n));
  await home(app);
  const esiti = {};
  for (const n of [...Object.keys(file), 'i.jpg', 'j.webp', 'k.gif', 'l.mp4', 'm.mp3', 'n.webm', 'o.wav', 'p.ico', 'q.bmp']) {
    const p = join(dir, n);
    const r = await execAction(app, { type: 'NAVIGA', url: p }, { parole: `aprimi ${p}` });
    await new Promise((ok) => setTimeout(ok, 800));
    const aperte = await tm(app, (t) => t.tabs.filter((s) => String(s.url).startsWith('file:')).map((s) => s.view.webContents.getURL().split('/').pop()));
    esiti[n] = `${r.executed ? 'aperto' : 'NO ' + JSON.stringify(r.output || r).slice(0, 80)} ${aperte.join(',')}`;
    await tm(app, (t) => { for (const s of t.tabs.filter((x) => String(x.url).startsWith('file:'))) t.closeTab(s.id); });
  }
  console.log('TIPI', JSON.stringify(esiti, null, 1));
});

test('barra degli indirizzi con un percorso: cosa vede l\'utente', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4b-'), 'report');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'r.html');
  writeFileSync(f, '<!doctype html><title>Report barra</title><h1>ciao</h1>');
  await home(app);
  const homeId = await tm(app, (t) => t.activeId);
  await tm(app, (t, { i, u }) => t.navigate(i, u), { i: homeId, u: f });
  const v = await avvisi();
  await new Promise((ok) => setTimeout(ok, 1500));
  console.log('AVVISO', await v.locator('.shell-notif').allInnerTexts());
});

test('Filo legge la scheda del file aperta e la pagina attiva', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4l-'), 'report');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'r.html');
  writeFileSync(f, '<!doctype html><title>Report letto</title><h1>Fatturato 2026: 42 mila euro</h1>');
  await home(app);
  expect((await execAction(app, { type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` })).executed).toBe(true);
  await new Promise((ok) => setTimeout(ok, 2500));
  const n = await tm(app, (t) => t.tabs.findIndex((s) => String(s.url).startsWith('file:')) + 1);
  const r1 = await execAction(app, { type: 'LEGGI_PAGINA', scheda: n }, { parole: 'cosa dice la pagina?' });
  const r2 = await execAction(app, { type: 'LEGGI_PAGINA', url: pathToFileURL(f).href }, { parole: 'cosa dice la pagina?' });
  console.log('LEGGI scheda', n, JSON.stringify(r1).slice(0, 400));
  console.log('LEGGI url', JSON.stringify(r2).slice(0, 400));
});

for (const tema of ['light', 'dark']) {
  test(`conferma in chat per un percorso non scritto dall'utente (${tema})`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    const dir = join(cartellaTemporanea('g4c-'), 'report');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, '2026-10-30-riquadro-conferma-schema.html');
    writeFileSync(f, '<!doctype html><title>Riquadro</title><h1>ciao</h1>');
    const page = await home(app);
    await app.evaluate(async (_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(f).href }) }] },
      { text: 'Ecco il report.' },
    ]);
    await chiedi(page, 'aprimi il report del riquadro di conferma che ho fatto ieri');
    await page.waitForTimeout(4000);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `g4-conferma-${tema}.png`) });
    await shell.screenshot({ path: join(SHOTS, `g4-conferma-shell-${tema}.png`) });
    console.log('CHAT', tema, (await page.locator('body').innerText()).slice(-600));
    await ripristina(app);
  });
}
