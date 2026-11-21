// #1905 giro 5: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
  .map((t) => { let u = ''; try { u = t.view.webContents.getURL(); } catch (_) {} return { id: t.id, url: t.url, vero: u }; }));
const schedaFile = async (app, fine) => (await schede(app)).find((t) => /^file:/.test(t.vero || t.url) && (t.vero || t.url).endsWith(fine))?.id || null;

function prepara() {
  const dir = join(cartellaTemporanea('g5-'), 'Documenti', 'report');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'capitolo.html'), '<!doctype html><title>Capitolo</title><p>uno</p>');
  writeFileSync(join(dir, 'indice.html'), `<!doctype html><title>Indice</title><body>
    <p><a id="cap" href="capitolo.html">capitolo</a></p>
    <p><a id="manca" href="manca.html">manca</a></p>
    <p><a id="web" href="https://example.com/">sito</a></p>
    <p id="js"></p><script>document.getElementById('js').textContent = 'Fatturato 4321 euro';</script></body>`);
  writeFileSync(join(dir, 'relazione città.html'), '<!doctype html><title>Accento</title><p>a</p>');
  writeFileSync(join(dir, 'report #3.html'), '<!doctype html><title>Cancelletto</title><p>a</p>');
  writeFileSync(join(dir, 'sconto 50%.html'), '<!doctype html><title>Percento</title><p>a</p>');
  return dir;
}

async function apri(app, file) {
  const r = await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` });
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, file.split('/').pop().replace(/ /g, '%20'))), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, id, (x) => x.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  return { r, id, p };
}

test('esplora', async ({ app }) => {
  test.setTimeout(180_000);
  const dir = prepara();
  await home(app);
  const log = (k, v) => console.log(`### ${k}: ${JSON.stringify(v)}`);

  // nomi strani, percorso grezzo
  for (const n of ['report #3.html', 'sconto 50%.html']) {
    const f = join(dir, n);
    const r = await execAction(app, { type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` });
    log(`grezzo ${n}`, { ex: r.executed, out: r.output });
  }
  // virgolette
  const quot = `"${join(dir, 'capitolo.html')}"`;
  log('virgolette', await execAction(app, { type: 'NAVIGA', url: quot }, { parole: `aprimi ${quot}` }).then((r) => ({ ex: r.executed, out: r.output, nc: r.needsConfirm })));
  // accento
  const senza = join(dir, 'relazione citta.html');
  log('accento', await execAction(app, { type: 'NAVIGA', url: senza }, { parole: `aprimi ${senza}` }).then((r) => ({ ex: r.executed, out: r.output, nc: r.needsConfirm })));
  log('schede dopo nomi', await schede(app));

  const { id, p } = await apri(app, join(dir, 'indice.html'));
  await expect(p).toHaveTitle('Indice');
  // lettura
  const lp = await execAction(app, { type: 'LEGGI_PAGINA' }, { parole: 'riassumimi la pagina che hai aperto' });
  log('LEGGI_PAGINA senza arg', { ex: lp.executed, out: JSON.stringify(lp.output || lp).slice(0, 600) });
  const lp2 = await execAction(app, { type: 'LEGGI_PAGINA', url: pathToFileURL(join(dir, 'indice.html')).href }, { parole: 'cosa dice' });
  log('LEGGI_PAGINA url', { ex: lp2.executed, out: JSON.stringify(lp2.output || lp2).slice(0, 600) });

  // collegamenti
  await p.locator('#cap').click({ modifiers: ['Control'] });
  await new Promise((r) => setTimeout(r, 1500));
  log('ctrl+clic fratello', await schede(app));
  await p.locator('#cap').click({ button: 'middle' });
  await new Promise((r) => setTimeout(r, 1500));
  log('clic centrale fratello', await schede(app));
  await p.evaluate(() => { const a = document.createElement('a'); a.id = 'nuova'; a.href = 'capitolo.html'; a.target = '_blank'; a.textContent = 'nuova'; document.body.append(a); });
  await p.locator('#nuova').click();
  await new Promise((r) => setTimeout(r, 1500));
  log('target blank fratello', await schede(app));

  // sito
  await p.locator('#web').click();
  await new Promise((r) => setTimeout(r, 2000));
  log('clic sito', { url: p.url(), schede: await schede(app) });

  // manca
  await p.locator('#manca').click();
  await new Promise((r) => setTimeout(r, 2000));
  log('clic manca', { url: p.url(), testo: await p.evaluate(() => document.body?.innerText || '').catch((e) => String(e)), schede: await schede(app) });

  // ricarica dopo cancellazione
  const { p: p2 } = await apri(app, join(dir, 'capitolo.html'));
  rmSync(join(dir, 'capitolo.html'));
  await p2.reload().catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  log('ricarica cancellato', { url: p2.url(), testo: await p2.evaluate(() => document.body?.innerText || '').catch((e) => String(e)) });
  log('fine schede', await schede(app));
  void id;
});
