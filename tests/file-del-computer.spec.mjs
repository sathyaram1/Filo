// #1905 — Un file del computer di cui l'utente dà il percorso si apre in una scheda: la pagina si vede intera, ma non
// legge altri file del disco. Un percorso che l'utente non ha scritto chiede il suo OK; un file che non c'è lo dice.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { paginaDellaScheda } from './helpers/schede.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const FOTO = join(process.cwd(), 'tests', 'fixtures', 'provenienza', 'c2pa-ufficiale-ai.png');

// Una cartella col nome dell'utente dentro (come «agenti AI»): lo stesso nome sta nella memoria di Filo.
function preparaReport() {
  const radice = cartellaTemporanea('file-');
  const dir = join(radice, 'Mario Rossi Bologna', 'report');
  const fuori = join(radice, 'altrove');
  mkdirSync(dir, { recursive: true });
  mkdirSync(fuori, { recursive: true });
  copyFileSync(FOTO, join(dir, 'foto.png'));
  copyFileSync(FOTO, join(fuori, 'privata.png'));
  writeFileSync(join(dir, 'stile.css'), '#t{color:rgb(1, 2, 3)}');
  writeFileSync(join(dir, 'vicino.txt'), 'VICINO');
  writeFileSync(join(fuori, 'segreto.txt'), 'SEGRETO');
  writeFileSync(join(dir, 'pagina2.html'), '<!doctype html><title>Seconda pagina</title><p>due</p>');
  writeFileSync(join(dir, '2026-10-30-riquadro.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Report locale</title>
    <link rel="stylesheet" href="stile.css"></head><body style="font:16px sans-serif;margin:24px">
    <h1 id="t">Riquadro di conferma</h1><img id="i" src="foto.png" width="120"><img id="o" src="${pathToFileURL(join(fuori, 'privata.png')).href}" width="10">
    <p><a id="due" href="pagina2.html">seconda</a></p>
    <script>document.body.dataset.js = 'si';</script></body></html>`);
  writeFileSync(join(dir, 'lettera.docx'), 'PK finto');
  return { file: join(dir, '2026-10-30-riquadro.html'), dir, fuori };
}

const schedaFile = (app, fine) => app.evaluate(({ BrowserWindow }, fine) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { return /^file:/.test(x.view.webContents.getURL() || x.url) && (x.view.webContents.getURL() || x.url).endsWith(fine); } catch (_) { return false; } });
  return t ? t.id : null;
}, fine);
const schedeFile = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
  .filter((t) => /^file:/.test(t.url || '')).length);
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('incollato in chat il percorso di un file HTML, Filo lo apre in una scheda con immagini e stile, senza chiedere', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const { file, fuori } = preparaReport();
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Mario Rossi, vive a Bologna.', PREFERENZE: '' }));
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] },
    { text: 'Ecco il report.' },
  ]);
  await chiedi(page, `aprimi questo ${file}`);

  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, '2026-10-30-riquadro.html')), { timeout: 15_000 }).toBeTruthy();
  let pagina = null;
  await expect.poll(async () => Boolean(pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  await expect(pagina).toHaveTitle('Report locale');
  await expect(pagina.locator('body')).toHaveAttribute('data-js', 'si');
  await expect.poll(() => pagina.evaluate(() => document.getElementById('i').naturalWidth), { message: 'l\'immagine della sua cartella si vede' }).toBeGreaterThan(0);
  expect(await pagina.evaluate(() => getComputedStyle(document.getElementById('t')).color)).toBe('rgb(1, 2, 3)');
  await expect(page.getByText('1 pagina: Report locale')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Potrebbe inviare tuoi dati')).toHaveCount(0);

  // La pagina locale non legge i file: né gli altri del disco, né quelli della sua cartella, né un'immagine fuori di lì.
  const letti = await pagina.evaluate(async ([fuori, vicino]) => {
    const prova = (u) => fetch(u).then((r) => r.text()).catch(() => 'NO');
    const xhr = (u) => new Promise((ok) => { const q = new XMLHttpRequest(); q.open('GET', u); q.onload = () => ok(q.responseText); q.onerror = () => ok('NO'); try { q.send(); } catch (_) { ok('NO'); } });
    return [await prova(fuori), await prova(vicino), await xhr(fuori), document.getElementById('o').naturalWidth];
  }, [pathToFileURL(join(fuori, 'segreto.txt')).href, new URL('vicino.txt', pagina.url()).href]);
  expect(letti).toEqual(['NO', 'NO', 'NO', 0]);

  mkdirSync(SHOTS, { recursive: true });
  await pagina.screenshot({ path: join(SHOTS, 'file-del-computer-scheda.png') });
  await page.screenshot({ path: join(SHOTS, 'file-del-computer-chat.png') });
  await shell.screenshot({ path: join(SHOTS, 'file-del-computer-shell.png') });

  // Il tasto destro di Filo c'è anche sulla pagina locale.
  await pagina.locator('#t').click({ button: 'right' });
  await expect(menuDi(pagina).locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  await pagina.keyboard.press('Escape');

  // Un collegamento a un'altra pagina della stessa cartella si segue.
  await pagina.locator('#due').click();
  await expect(pagina).toHaveTitle('Seconda pagina', { timeout: 8000 });

  // Chiusa la scheda, il collegamento in chat la riapre col clic dell'utente.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(id), id);
  await expect.poll(() => schedeFile(app)).toBe(0);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => String(t.url).startsWith('filo://newtab')).id);
  });
  await page.getByRole('link', { name: '↗ 2026-10-30-riquadro.html' }).click();
  await expect.poll(() => schedaFile(app, '2026-10-30-riquadro.html'), { timeout: 10_000 }).toBeTruthy();
  await ripristina(app);
});

test('un percorso che l\'utente non ha scritto chiede il suo OK, e confermato si apre', async ({ app }) => {
  const { file } = preparaReport();
  await home(app);
  const url = pathToFileURL(file).href;
  const chiesto = await execAction(app, { type: 'NAVIGA', url }, { parole: 'apri il report di ieri' });
  expect(chiesto.executed).toBeFalsy();
  expect(chiesto.needsConfirm).toBe(2);
  expect(JSON.stringify(chiesto.describe)).toContain('Il percorso non l\'hai scritto tu');
  expect(await schedeFile(app)).toBe(0);

  const ok = await execAction(app, { type: 'NAVIGA', url }, { confirmed: true, parole: 'apri il report di ieri' });
  expect(ok.executed).toBe(true);
  await expect.poll(() => schedaFile(app, '2026-10-30-riquadro.html'), { timeout: 10_000 }).toBeTruthy();
});

test('un file che non c\'è, una cartella o un tipo che la scheda non mostra non aprono niente e lo dicono', async ({ app }) => {
  const { dir } = preparaReport();
  await home(app);
  for (const [percorso, motivo] of [[join(dir, 'manca.html'), 'assente'], [dir, 'cartella'], [join(dir, 'lettera.docx'), 'tipo']]) {
    const r = await execAction(app, { type: 'NAVIGA', url: percorso }, { parole: `apri ${percorso}` });
    expect(r.output, percorso).toMatchObject({ blocked: 'file', motivo });
  }
  expect(await schedeFile(app)).toBe(0);
});

test('un PDF e un\'immagine si aprono in una scheda, senza diventare uno scaricamento', async ({ app }) => {
  const { dir } = preparaReport();
  const pdf = join(dir, 'conto.pdf');
  copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'documenti', 'documento-con-testo.pdf'), pdf);
  await home(app);
  // Ogni scheda di un file ha la sua sessione: si guardano gli scaricamenti di tutte quelle che nascono.
  await app.evaluate(({ app: a }) => {
    globalThis.__scaricati = [];
    a.on('session-created', (s) => s.on('will-download', (_e, item) => globalThis.__scaricati.push(item.getFilename())));
  });
  for (const f of [pdf, join(dir, 'foto.png')]) {
    const r = await execAction(app, { type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` });
    expect(r.executed, f).toBe(true);
  }
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'foto.png')), { timeout: 10_000 }).toBeTruthy();
  const foto = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  await expect.poll(() => foto.evaluate(() => (document.querySelector('img') || {}).naturalWidth || 0)).toBeGreaterThan(0);
  let idPdf = null;
  await expect.poll(async () => (idPdf = await schedaFile(app, 'conto.pdf')), { timeout: 10_000 }).toBeTruthy();
  await foto.waitForTimeout(1500);
  expect(await schedaFile(app, 'conto.pdf'), 'il PDF resta nella sua scheda').toBeTruthy();
  expect(await app.evaluate(() => globalThis.__scaricati)).toEqual([]);
  // Il PDF si vede anche con la CSP che ora va su ogni risposta.
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), idPdf);
  await foto.waitForTimeout(2000);
  const png = await app.evaluate(async ({ BrowserWindow }, i) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
    return (await t.view.webContents.capturePage()).toPNG().toString('base64');
  }, idPdf);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, 'file-del-computer-pdf.png'), Buffer.from(png, 'base64'));
});

// Quello che la sessione della scheda lascia leggere: la risposta del gestore dei file per quell'indirizzo.
const leggeLaScheda = (app, id, url) => app.evaluate(async ({ BrowserWindow, session }, { id, url }) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === id);
  const partizione = t ? t.partition : globalThis.__ultimaPartizioneFile;
  globalThis.__ultimaPartizioneFile = partizione;
  try { return (await session.fromPartition(partizione).fetch(url)).status; } catch (e) { return `errore ${e.message}`; }
}, { id, url });

test('un XML con uno script e un file senza estensione con dentro HTML non leggono gli altri file della cartella', async ({ app }) => {
  const { dir } = preparaReport();
  writeFileSync(join(dir, 'fattura.xml'), `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fattura</title></head><body><p>Fattura 12</p>
<script>document.documentElement.setAttribute('data-js', 'si');
fetch('vicino.txt').then(function (r) { return r.text(); }).then(function (t) { document.documentElement.setAttribute('data-letto', t); },
  function () { document.documentElement.setAttribute('data-letto', 'NO'); });</script></body></html>`);
  writeFileSync(join(dir, 'pagina'), '<!doctype html><title>Senza estensione</title><script>fetch("vicino.txt").then((r) => r.text()).then((t) => { document.title = t; });</script>');
  await home(app);
  const xml = join(dir, 'fattura.xml');
  expect((await execAction(app, { type: 'NAVIGA', url: xml }, { parole: `aprimi ${xml}` })).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'fattura.xml')), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  await expect(pagina.locator('html')).toHaveAttribute('data-js', 'si', { timeout: 10_000 });
  await expect(pagina.locator('html'), 'lo script del file XML non legge il file accanto').toHaveAttribute('data-letto', 'NO');
  mkdirSync(SHOTS, { recursive: true });
  await pagina.screenshot({ path: join(SHOTS, 'file-del-computer-xml.png') });

  // Il file senza estensione non si serve, nemmeno a un collegamento della stessa cartella.
  expect(await leggeLaScheda(app, id, pathToFileURL(join(dir, 'pagina')).href)).toBe(403);
  expect(await leggeLaScheda(app, id, pathToFileURL(join(dir, 'foto.png')).href), 'le immagini accanto sì').toBe(200);
  await pagina.evaluate((u) => { location.href = u; }, pathToFileURL(join(dir, 'pagina')).href);
  await pagina.waitForTimeout(1500);
  expect(await pagina.title()).not.toBe('VICINO');
});

test('ogni scheda legge solo la cartella del suo file, e chiusa la scheda la cartella si richiude', async ({ app }) => {
  const { file, dir, fuori } = preparaReport();
  writeFileSync(join(fuori, 'altra.html'), '<!doctype html><title>Altra</title><p>altra</p>');
  await home(app);
  const altra = join(fuori, 'altra.html');
  for (const f of [file, altra]) expect((await execAction(app, { type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` })).executed).toBe(true);
  let uno = null;
  let due = null;
  await expect.poll(async () => (uno = await schedaFile(app, '2026-10-30-riquadro.html')), { timeout: 10_000 }).toBeTruthy();
  await expect.poll(async () => (due = await schedaFile(app, 'altra.html')), { timeout: 10_000 }).toBeTruthy();
  const privata = pathToFileURL(join(fuori, 'privata.png')).href;
  const foto = pathToFileURL(join(dir, 'foto.png')).href;
  expect(await leggeLaScheda(app, due, privata)).toBe(200);
  expect(await leggeLaScheda(app, uno, privata), 'la cartella aperta dall\'altra scheda resta chiusa').toBe(403);
  expect(await leggeLaScheda(app, due, foto)).toBe(403);
  expect(await leggeLaScheda(app, uno, foto)).toBe(200);
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(i), uno);
  await expect.poll(() => schedaFile(app, '2026-10-30-riquadro.html')).toBeFalsy();
  expect(await leggeLaScheda(app, '', foto), 'chiusa la scheda, la sua sessione non legge più niente').toBe(403);
});

test('una scheda della sessione salvata su una cartella di rete non torna, e non tocca l\'altro computer', async ({ app }) => {
  test.skip(process.platform === 'win32', 'le cartelle /net/<host> sono di Mac e Linux');
  const { file } = preparaReport();
  await home(app);
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: ['file:///net/segreto-mario/condivisa/x.html', u], activeIndex: 0 });
    await tm.restoreSession();
  }, pathToFileURL(file).href);
  await expect.poll(() => schedaFile(app, '2026-10-30-riquadro.html'), { timeout: 10_000 }).toBeTruthy();
  expect(await schedaFile(app, 'x.html')).toBeNull();
});

// Una pagina aperta dalla cartella di casa: lì la casa non si concede intera (chiavi, profili, documenti).
const CASA = cartellaTemporanea('casa-');
test.describe('aperto un file nella cartella di casa', () => {
  test.use({ envInPiu: { HOME: CASA, USERPROFILE: CASA } });
  test('la pagina si vede con le immagini che nomina, e non legge gli altri file della casa', async ({ app }) => {
    mkdirSync(join(CASA, 'Documenti'), { recursive: true });
    mkdirSync(join(CASA, '.ssh'), { recursive: true });
    copyFileSync(FOTO, join(CASA, 'foto.png'));
    copyFileSync(FOTO, join(CASA, 'Documenti', 'passaporto.png'));
    writeFileSync(join(CASA, '.ssh', 'id_rsa'), 'CHIAVE');
    const appunti = join(CASA, 'appunti.html');
    writeFileSync(appunti, '<!doctype html><title>Appunti</title><h1>Appunti</h1><img id="i" src="foto.png" width="80">');
    await home(app);
    expect(await app.evaluate(() => process.env.HOME)).toBe(CASA);
    expect((await execAction(app, { type: 'NAVIGA', url: appunti }, { parole: `aprimi ${appunti}` })).executed).toBe(true);
    let id = null;
    await expect.poll(async () => (id = await schedaFile(app, 'appunti.html')), { timeout: 10_000 }).toBeTruthy();
    await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
    const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
    await expect(pagina).toHaveTitle('Appunti');
    await expect.poll(() => pagina.evaluate(() => document.getElementById('i').naturalWidth)).toBeGreaterThan(0);
    expect(await leggeLaScheda(app, id, pathToFileURL(join(CASA, 'Documenti', 'passaporto.png')).href)).toBe(403);
    expect(await leggeLaScheda(app, id, pathToFileURL(join(CASA, '.ssh', 'id_rsa')).href)).toBe(403);
    expect(await pagina.evaluate((u) => fetch(u).then((r) => r.text()).catch(() => 'NO'), pathToFileURL(join(CASA, 'foto.png')).href)).toBe('NO');
  });
});

// L'Aiuto sopra un sito vive nel DOM della pagina, che può scrivergli le parole e premergli i bottoni.
test('l\'Aiuto sopra un sito non apre un file del computer nemmeno col percorso scritto, e dice di usare la home', async ({ app }) => {
  const { file } = preparaReport();
  await home(app);
  const r = await execAction(app, { type: 'NAVIGA', url: pathToFileURL(file).href }, { assistente: true, parole: `apri ${file}` });
  expect(r.executed).toBeFalsy();
  expect(r.output).toMatchObject({ blocked: 'file', motivo: 'assistente' });
  expect(await app.evaluate((_e, o) => globalThis.SN_ESITO.motivo({ type: 'NAVIGA', _output: o }), r.output)).toContain('home');
  await new Promise((ok) => setTimeout(ok, 500));
  expect(await schedeFile(app)).toBe(0);
});

test('riaperto Filo, la scheda del file torna dalla sessione salvata e si vede', async ({ app }) => {
  const { file } = preparaReport();
  await home(app);
  const url = pathToFileURL(file).href;
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: ['filo://newtab/', u], activeIndex: 1 });
    await tm.restoreSession();
  }, url);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, '2026-10-30-riquadro.html')), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  let pagina = null;
  await expect.poll(async () => Boolean(pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  await expect(pagina).toHaveTitle('Report locale', { timeout: 10_000 });
  await expect.poll(() => pagina.evaluate(() => document.getElementById('i').naturalWidth), { message: 'le immagini della sua cartella tornano' }).toBeGreaterThan(0);
});

test('il collegamento in chat a un file spostato o cancellato lo dice, e non apre niente', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const { file } = preparaReport();
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] },
    { text: 'Ecco il report.' },
  ]);
  await chiedi(page, `aprimi questo ${file}`);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, '2026-10-30-riquadro.html')), { timeout: 15_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, id) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.closeTab(id);
    tm.activate(tm.tabs.find((t) => String(t.url).startsWith('filo://newtab')).id);
  }, id);
  await expect.poll(() => schedeFile(app)).toBe(0);
  rmSync(file);
  await page.getByRole('link', { name: '↗ 2026-10-30-riquadro.html' }).click();
  await expect((await avvisi()).locator('.shell-notif.show', { hasText: /File non trovato: .*2026-10-30-riquadro\.html/ })).toBeVisible({ timeout: 8000 });
  expect(await schedeFile(app)).toBe(0);
  await ripristina(app);
});

test('chiusa, la scheda del file torna con Ctrl+Shift+T', async ({ app }) => {
  const { file } = preparaReport();
  await home(app);
  const r = await execAction(app, { type: 'NAVIGA', url: file }, { parole: `apri ${file}` });
  expect(r.executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, '2026-10-30-riquadro.html')), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(id), id);
  await expect.poll(() => schedeFile(app)).toBe(0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riapriChiusa());
  await expect.poll(() => schedaFile(app, '2026-10-30-riquadro.html'), { timeout: 10_000 }).toBeTruthy();
});
