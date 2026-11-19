// Verifica #1905 giro 1: un file del computer che l'utente indica si apre in una scheda, e la pagina non legge il resto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmText } from '../../helpers/confirm.mjs';
import { cartellaInCasa, togliCartella } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ICONA = resolve('assets/icons/icon-256.png');

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { let u = ''; let titolo = ''; try { u = t.view.webContents.getURL(); titolo = t.view.webContents.getTitle(); } catch (_) {} return { id: t.id, url: u || t.url || '', titolo }; });
});
const schedaFile = async (app, pezzo) => (await schede(app)).find((s) => s.url.startsWith('file:') && decodeURIComponent(s.url).includes(pezzo));
const nellaScheda = (app, id, js) => app.evaluate(({ BrowserWindow }, [i, codice]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.find((t) => t.id === i).view.webContents.executeJavaScript(codice);
}, [id, js]);
const foto = (app, id, nome) => app.evaluate(async ({ BrowserWindow }, i) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const img = await tm.tabs.find((t) => t.id === i).view.webContents.capturePage();
  return img.toPNG().toString('base64');
}, id).then((b) => { mkdirSync('tests/.shots', { recursive: true }); writeFileSync(`tests/.shots/1905-${nome}.png`, Buffer.from(b, 'base64')); });

const PDF = () => {
  const ogg = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const flusso = 'BT /F1 24 Tf 40 100 Td (Ciao PDF 1905) Tj ET';
  ogg[3] = `<< /Length ${flusso.length} >>\nstream\n${flusso}\nendstream`;
  let s = '%PDF-1.4\n';
  const off = [];
  ogg.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${ogg.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${ogg.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return s;
};

let dir; let altrove;
test.beforeEach(() => {
  dir = join(cartellaInCasa('filo-1905-'), 'Desktop', 'Filo', 'report');
  mkdirSync(join(dir, 'sotto'), { recursive: true });
  altrove = cartellaInCasa('filo-1905-segreti-');
  writeFileSync(join(altrove, 'segreto.txt'), 'SEGRETO-1905');
  copyFileSync(ICONA, join(dir, 'sotto', 'logo.png'));
  copyFileSync(ICONA, join(altrove, 'altrove.png'));
  writeFileSync(join(dir, 'accanto.txt'), 'ACCANTO-1905');
  writeFileSync(join(dir, '2026-10-30-riquadro-conferma-schema.html'), `<!doctype html><meta charset="utf-8"><title>Report 1905</title>
    <h1 style="font:32px sans-serif">Riquadro di conferma</h1><img id="dentro" src="sotto/logo.png" width="80">
    <img id="fuori" src="${pathToFileURL(join(altrove, 'altrove.png')).href}" width="80">
    <script>
      window.__esiti = {};
      const prova = (k, u) => fetch(u).then((r) => r.text()).then((t) => { window.__esiti[k] = 'letto:' + t.slice(0, 20); }, (e) => { window.__esiti[k] = 'no:' + e.message; });
      prova('segreto', ${JSON.stringify(pathToFileURL(join(altrove, 'segreto.txt')).href)});
      prova('accanto', 'accanto.txt');
      prova('passwd', 'file:///etc/passwd');
    </script>`);
  writeFileSync(join(dir, 'conto.pdf'), PDF());
  copyFileSync(ICONA, join(dir, 'foto vacanze.png'));
});
test.afterEach(() => { try { togliCartella(resolve(dir, '..', '..', '..')); togliCartella(altrove); } catch (_) {} });

test('chat: il percorso incollato dall\'utente, aperto con NAVIGA file:///, si vede in una scheda senza avvisi sui dati', async ({ app }) => {
  test.setTimeout(60_000);
  await app.evaluate(async (_e, d) => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: `Lavora nella cartella ${d}, progetto Filo, report del 2026-10-30.` }), dir);
  const page = await home(app);
  const file = join(dir, '2026-10-30-riquadro-conferma-schema.html');
  const url = pathToFileURL(file).href;
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `apri ${file}`);
  await expect.poll(async () => (await schedaFile(app, 'riquadro-conferma-schema'))?.titolo || '', { timeout: 10_000 }).toBe('Report 1905');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  const s = await schedaFile(app, 'riquadro-conferma-schema');
  await expect.poll(() => nellaScheda(app, s.id, 'Object.keys(window.__esiti).length'), { timeout: 5000 }).toBe(3);
  const esiti = await nellaScheda(app, s.id, 'window.__esiti');
  console.log('esiti', JSON.stringify(esiti));
  expect(esiti.segreto).not.toContain('SEGRETO');
  expect(esiti.passwd).not.toContain('letto:root');
  const img = await nellaScheda(app, s.id, '[document.getElementById("dentro").naturalWidth, document.getElementById("fuori").naturalWidth]');
  console.log('immagini dentro/fuori', img);
  expect(img[0], 'l\'immagine della sottocartella si vede').toBeGreaterThan(0);
  expect(img[1], 'l\'immagine di un\'altra cartella no').toBe(0);
  await foto(app, s.id, 'html');
  const bolle = await page.locator('.dash-bubble').allTextContents();
  console.log('chat', bolle.join(' | '));
});

test('chat: il percorso grezzo con spazi, senza file://, si apre lo stesso', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const file = join(dir, 'foto vacanze.png');
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: file }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `mi apri ${file} ?`);
  await expect.poll(async () => !!(await schedaFile(app, 'foto vacanze.png')), { timeout: 10_000 }).toBe(true);
  const s = await schedaFile(app, 'foto vacanze.png');
  await expect.poll(() => nellaScheda(app, s.id, 'document.images[0] ? document.images[0].naturalWidth : -1'), { timeout: 5000 }).toBeGreaterThan(0);
  await foto(app, s.id, 'png');
});

test('chat: un PDF si apre in una scheda e si vede', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const file = join(dir, 'conto.pdf');
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `apri il pdf ${file}`);
  await expect.poll(async () => !!(await schedaFile(app, 'conto.pdf')), { timeout: 10_000 }).toBe(true);
  const s = await schedaFile(app, 'conto.pdf');
  await page.waitForTimeout(3000);
  console.log('pdf', JSON.stringify(await schedaFile(app, 'conto.pdf')));
  console.log('pdf embed', await nellaScheda(app, s.id, 'document.body ? document.body.innerHTML.slice(0,300) : "(nessun body)"'));
  await foto(app, s.id, 'pdf');
});

test('barra degli indirizzi: un file del computer scritto dall\'utente si apre', async ({ app, shell }) => {
  const file = join(dir, '2026-10-30-riquadro-conferma-schema.html');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pathToFileURL(file).href);
  await expect.poll(async () => (await schedaFile(app, 'riquadro-conferma-schema'))?.titolo || '', { timeout: 10_000 }).toBe('Report 1905');
});

test('una pagina del computer non può portarsi su un file di un\'altra cartella', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  writeFileSync(join(dir, 'salta.html'), `<!doctype html><title>Salta</title><a id="a" href="${pathToFileURL(join(altrove, 'segreto.txt')).href}">x</a>
    <script>setTimeout(() => { location.href = ${JSON.stringify(pathToFileURL(join(altrove, 'segreto.txt')).href)}; }, 300);</script>`);
  const file = join(dir, 'salta.html');
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `apri ${file}`);
  await expect.poll(async () => !!(await schedaFile(app, 'salta.html')), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(2000);
  const tutte = await schede(app);
  console.log('dopo salto', JSON.stringify(tutte));
  for (const s of tutte) {
    const t = await nellaScheda(app, s.id, 'document.body ? document.body.innerText.slice(0, 200) : ""').catch(() => '');
    expect(t).not.toContain('SEGRETO-1905');
  }
});

test('un percorso che l\'utente non ha scritto, dopo una lettura di altri, chiede l\'OK con parole adatte a un file', async ({ app }) => {
  const r = await app.evaluate((_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: u },
    { contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }] }), pathToFileURL(join(altrove, 'segreto.txt')).href);
  console.log('sporco', JSON.stringify(r));
  expect(r.executed).toBeFalsy();
  expect(String(r.describe || '')).not.toMatch(/memoria/i);
});

test('un file che non c\'è lo dice', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const file = join(dir, 'non-esiste.html');
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Fatto.' }]);
  await chiedi(page, `apri ${file}`);
  await page.waitForTimeout(3000);
  console.log('mancante schede', JSON.stringify(await schede(app)));
  const storia = await app.evaluate(() => globalThis.__chatFinta_calls || []);
  console.log('mancante esito al modello', JSON.stringify(storia[storia.length - 1]?.slice(-1)));
});
