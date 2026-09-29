// Esplorazione del giro 15 (#590): porte nuove della ripresa. Si cancella o si rinomina prima della critica.
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test as base, expect, lista, schede, apri, idAttiva, contaAvvisi, schedaSu, chiudiApp, cartellaTemporanea, HOSTS } from '../../helpers/reteFinta.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..', '..');
const EXTRA = ['xn--mnchen-3ya.de', 'xn--80aswg.xn--p1ai'];

const test = base.extend({
  app: async ({ rete }, use) => {
    const userData = cartellaTemporanea('filo-test-');
    const rules = [...HOSTS, ...EXTRA].map((h) => `MAP ${h} 127.0.0.1:${rete.port}`).join(', ');
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=${rules}`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

const PAGINA_BLOCCATA = /^filo:\/\/error\/error\.html\?.*code=blocked/;
const caricataSu = async (app, host) => ((await schedaSu(app, host)) || {}).caricata || '';
const paginaBloccata = (app) => app.windows().find((w) => PAGINA_BLOCCATA.test(w.url()));

async function testiAvvisi(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__toast590 = [];
    const orig = w.webContents.send.bind(w.webContents);
    w.webContents.send = (ch, ...a) => { if (ch === 'shell:toast') globalThis.__toast590.push(a[0] && a[0].text); return orig(ch, ...a); };
  });
  return () => app.evaluate(() => globalThis.__toast590.slice());
}

test('IDN: nome nella notifica e nella pagina «Sito bloccato»', async ({ app, shell, rete }) => {
  await lista(shell, ['münchen.de']);
  const t = await testiAvvisi(app);
  const sito = rete.pagina('xn--mnchen-3ya.de', '/', '<h1>MUENCHEN</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'http://münchen.de/');
  await shell.waitForTimeout(1500);
  console.log('TOAST IDN', JSON.stringify(await t()));
  await lista(shell, []);
  await apri(app, shell, sito);
  await lista(shell, ['münchen.de']);
  await expect.poll(() => caricataSu(app, 'mnchen'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  const p = paginaBloccata(app);
  console.log('ERR HOST IDN', await p.locator('#err-host').textContent(), 'TITLE', await p.title());
  const barra = await shell.evaluate(() => { const i = document.querySelector('#url, #address, .url-input, input[type=text]'); return i ? i.value : null; });
  console.log('BARRA', barra);
  await shell.screenshot({ path: 'tests/.shots/590-g15-idn-shell.png' });
});

test('IDN a estensione non latina: la voce in lista blocca?', async ({ app, shell, rete }) => {
  await lista(shell, ['сайт.рф']);
  const t = await testiAvvisi(app);
  rete.pagina('xn--80aswg.xn--p1ai', '/', '<h1>RF</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'http://сайт.рф/');
  await shell.waitForTimeout(2500);
  console.log('RF SCHEDE', JSON.stringify(await schede(app)), 'TOAST', JSON.stringify(await t()));
});

test('«Apri comunque» della notifica premuto tre volte', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  const btn = card.locator('.shell-notif-action', { hasText: 'Apri comunque' });
  await btn.click();
  await btn.click({ timeout: 1500 }).catch((e) => console.log('secondo clic non possibile', e.message.split('\n')[0]));
  await btn.click({ timeout: 1500 }).catch((e) => console.log('terzo clic non possibile', e.message.split('\n')[0]));
  await shell.waitForTimeout(2000);
  console.log('SCHEDE DOPO 3 CLIC', JSON.stringify((await schede(app)).filter((u) => u.includes('blocked.test'))));
});

test('la pagina torna indietro da sola su un sito messo in lista nel frattempo', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1 id="s">SITO</h1><script>document.title="SITO-VIVO"</script>');
  const altro = rete.pagina('sito.test', '/', '<h1>ALTRO</h1><button id="b" onclick="history.back()">indietro</button>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, altro]);
  await expect.poll(() => caricataSu(app, 'sito.test'), { timeout: 6000 }).toBe(altro);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.evaluate(() => history.back());
  await shell.waitForTimeout(2500);
  const s = await app.evaluate(({ BrowserWindow }, i) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === i);
    return { url: t.url, caricata: t.view.webContents.getURL(), title: t.title };
  }, id);
  console.log('DOPO history.back()', JSON.stringify(s), 'AVVISI', JSON.stringify(await avvisi()));
});

test('pagina «Sito bloccato»: tema chiaro e scuro', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, sito);
  await lista(shell, ['blocked.test']);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  await shell.waitForTimeout(800);
  await shell.screenshot({ path: 'tests/.shots/590-g15-chiaro-shell.png' });
  await paginaBloccata(app).screenshot({ path: 'tests/.shots/590-g15-chiaro.png' });
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await shell.waitForTimeout(1200);
  await paginaBloccata(app).screenshot({ path: 'tests/.shots/590-g15-scuro.png' });
  await shell.screenshot({ path: 'tests/.shots/590-g15-scuro-shell.png' });
});

test('finestra in incognito: il sito messo in lista passa alla pagina «Sito bloccato» e «Apri comunque» funziona', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1 id="s">SITO</h1>');
  const esito = await app.evaluate(async ({ BrowserWindow }, u) => {
    const main = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoTabs.incognito);
    const mod = require(require('path').join(process.cwd(), 'src/main/window.js'));
    return Object.keys(mod);
  }, sito).catch((e) => String(e));
  console.log('window.js exports', JSON.stringify(esito));
});

test('modalità privacy dei cookie: pagina «Sito bloccato» e «Apri comunque»', async ({ app, shell, rete }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { security: { cookies: { mode: 'privacy' } } } }));
  await shell.waitForTimeout(500);
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1 id="s">SITO</h1>');
  await apri(app, shell, sito);
  await lista(shell, ['blocked.test']);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  await shell.waitForTimeout(800);
  const p = paginaBloccata(app);
  console.log('PRIVACY titolo', await p.locator('h1').textContent());
  await p.locator('button', { hasText: 'Apri comunque' }).click();
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toBe(sito);
});
