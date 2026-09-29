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

test('SONDA: history.back() della pagina, sequenza di eventi', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1 id="s">SITO</h1><script>document.title="SITO-VIVO"; new Image().src="http://sito.test/ping-" + Date.now();</script>');
  const altro = rete.pagina('sito.test', '/', '<title>ALTRO</title><h1>ALTRO</h1>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, altro]);
  await expect.poll(() => caricataSu(app, 'sito.test'), { timeout: 6000 }).toBe(altro);
  await shell.waitForTimeout(500);
  await lista(shell, ['blocked.test']);
  await app.evaluate(({ BrowserWindow }, i) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === i);
    const wc = t.view.webContents;
    globalThis.__ev = [];
    const log = (n) => (...a) => globalThis.__ev.push(n + ' ' + a.slice(1).filter((x) => typeof x !== 'object').join(' '));
    for (const n of ['will-navigate', 'did-start-navigation', 'did-navigate', 'did-fail-load', 'page-title-updated', 'did-stop-loading', 'will-redirect']) wc.on(n, log(n));
  }, id);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.evaluate(() => history.back());
  await shell.waitForTimeout(2500);
  console.log('EVENTI', JSON.stringify(await app.evaluate(() => globalThis.__ev), null, 1));
  const s = await app.evaluate(({ BrowserWindow }, i) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === i);
    return { url: t.url, caricata: t.view.webContents.getURL(), title: t.title, wctitle: t.view.webContents.getTitle() };
  }, id);
  console.log('STATO', JSON.stringify(s));
  const titoloStriscia = await shell.evaluate(() => Array.from(document.querySelectorAll('.tab, [data-tab-id]')).map((e) => e.textContent.trim()).join(' | '));
  console.log('STRISCIA', titoloStriscia);
});

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function modelloFinto(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    globalThis.__calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__calls.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)]; n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}

test('SONDA: NAVIGA del modello verso un accorciatore che rimbalza sul sito della lista', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.rimbalzo('accorcia.test', '/x', bersaglio);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: corto, etichetta: 'pagina' }) }] },
    { text: 'FATTO-FINTO' },
  ]);
  const avvisi = await contaAvvisi(app);
  await page.locator('#input').fill('apri quel link');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FATTO-FINTO' })).toBeVisible({ timeout: 10_000 });
  await shell.waitForTimeout(2500);
  console.log('SCHEDE', JSON.stringify(await schede(app)), 'AVVISI', JSON.stringify(await avvisi()));
  const activity = page.locator('.dash-activity');
  console.log('DIARIO', await activity.locator('.dash-activity-label').textContent({ timeout: 2000 }).catch(() => 'nessuno'));
  console.log('BOLLE', JSON.stringify(await page.locator('.dash-bubble-filo').allTextContents()));
  await activity.locator('.dash-activity-head').click({ timeout: 2000 }).catch(() => {});
  console.log('RIGHE', JSON.stringify(await activity.locator('.dash-activity-row').allTextContents().catch(() => [])));
  const calls = await app.evaluate(() => globalThis.__calls);
  const secondo = JSON.stringify(calls[1] || []);
  const m = secondo.match(/.{0,200}NAVIGA.{0,300}/g);
  console.log('AL MODELLO', JSON.stringify((m || []).slice(-2)));
  await page.screenshot({ path: 'tests/.shots/590-g15-naviga-rimbalzo.png' });
});

test('SONDA: Preferenze, voce a estensione non latina e descrizione', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  let p = null;
  for (let i = 0; i < 50 && !p; i++) { p = app.windows().find((w) => w.url().startsWith('filo://security')); if (!p) await shell.waitForTimeout(200); }
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(800);
  console.log('DESC', await p.locator('#sec-siteblock-desc').textContent(), 'VISIBILE', await p.locator('#sec-siteblock-desc').isVisible());
  const ta = p.locator('#sec-siteblock-blacklist');
  await ta.scrollIntoViewIfNeeded();
  await ta.fill('сайт.рф\nmünchen.de');
  await ta.dispatchEvent('change');
  await p.waitForTimeout(800);
  console.log('ERRORE', await p.locator('#sec-siteblock-blacklist-error').textContent(), 'VIS', await p.locator('#sec-siteblock-blacklist-error').isVisible());
  const salvata = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.siteBlock.blacklist);
  console.log('SALVATA', JSON.stringify(salvata));
  await p.reload();
  await p.waitForTimeout(1000);
  console.log('RILETTA', JSON.stringify(await p.locator('#sec-siteblock-blacklist').inputValue()));
  await p.locator('#sec-siteblock-desc').scrollIntoViewIfNeeded();
  await p.screenshot({ path: 'tests/.shots/590-g15-preferenze.png' });
});

test('SONDA: incognito, sito messo in lista mentre è aperto', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1 id="s">SITO</h1>');
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.waitForTimeout(1500);
  const r = await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoTabs.incognito);
    if (!w) return 'no incognito';
    w._filoTabs.openTab(u, { activate: true });
    return 'ok';
  }, sito);
  console.log('INCOGNITO', r);
  await shell.waitForTimeout(1500);
  await lista(shell, ['blocked.test']);
  await shell.waitForTimeout(1500);
  const stato = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoTabs.incognito);
    return w._filoTabs.tabs.map((t) => ({ url: t.url, caricata: t.view.webContents.getURL() }));
  });
  console.log('INCOGNITO STATO', JSON.stringify(stato));
  const pag = app.windows().find((w) => /code=blocked/.test(w.url()));
  if (pag) {
    console.log('INCOGNITO H1', await pag.locator('h1').textContent());
    await pag.locator('button', { hasText: 'Apri comunque' }).click();
    await shell.waitForTimeout(1500);
    const dopo = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoTabs.incognito);
      return w._filoTabs.tabs.map((t) => t.view.webContents.getURL());
    });
    console.log('INCOGNITO DOPO', JSON.stringify(dopo));
    const normali = await schede(app);
    console.log('NORMALE', JSON.stringify(normali));
  }
});

test('SONDA: assistente sulla pagina, NAVIGA verso un accorciatore sul sito della lista', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.rimbalzo('accorcia.test', '/y', bersaglio);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await shell.waitForTimeout(1000);
  const page = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await page.waitForFunction(() => !!window.SN_SIDEBAR && !!window.__filoSidebarTest, null, { timeout: 8000 });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const avvisi = await contaAvvisi(app);
  const esito = await page.evaluate((u) => window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: u }), corto);
  await shell.waitForTimeout(2500);
  console.log('SIDEBAR ESITO', esito, 'LOG', JSON.stringify(await page.locator('.sn-sidebar-log').allTextContents()), 'SCHEDE', JSON.stringify(await schede(app)), 'AVVISI', JSON.stringify(await avvisi()));
});

test('SONDA: dopo «Apri comunque», la finestrella di accesso dello stesso sito', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const fine = rete.pagina('blocked.test', '/oauth/authorize', '<h1 id="ok">ACCESSO DEL SITO</h1><a id="avanti" href="/login/ok">continua</a>');
  rete.pagina('blocked.test', '/login/ok', '<h1 id="ok2">ENTRATO</h1>');
  const login = rete.rimbalzo('blocked.test', '/login', fine + '?client_id=a&response_type=code');
  const sito = rete.pagina('blocked.test', '/', `<h1>SITO</h1><button id="b" onclick="window.open('${login}', 'accesso', 'width=500,height=400')">accedi</button><button id="c" onclick="window.open('${fine}?client_id=a&response_type=code', 'accesso2', 'width=500,height=400')">accedi2</button>`);
  const avvisi = await contaAvvisi(app);
  await shell.evaluate((u) => window.filoShell.tabs.openBlockedPopup(u, true), sito);
  await shell.waitForTimeout(1500);
  const tab = app.windows().find((w) => w.url() === sito);
  console.log('SITO APERTO', !!tab);
  await tab.click('#b');
  await shell.waitForTimeout(2500);
  const fin = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w._filoTabs).map((w) => { try { return w.webContents.getURL(); } catch (_) { return '?'; } }));
  console.log('FINESTRELLE dopo rimbalzo', JSON.stringify(fin), 'AVVISI', JSON.stringify(await avvisi()));
  await tab.click('#c');
  await shell.waitForTimeout(2500);
  const tutte = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => { try { return (w._filoTabs ? 'SHELL ' : '') + w.webContents.getURL() + ' vis=' + w.isVisible(); } catch (_) { return '?'; } }));
  console.log('TUTTE', JSON.stringify(tutte), 'AVVISI', JSON.stringify(await avvisi()));
  await shell.waitForTimeout(5000);
  const dopo5 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w._filoTabs).map((w) => ({ url: w.webContents.getURL(), vis: w.isVisible(), b: w.getBounds(), title: w.getTitle(), loading: w.webContents.isLoading() })));
  console.log('DOPO 5s', JSON.stringify(dopo5));
  const pop = app.windows().find((w) => w.url().includes('/oauth/authorize'));
  console.log('FINESTRELLA diretta', pop ? pop.url() : 'nessuna');
  if (pop) {
    await pop.click('#avanti').catch(() => {});
    await shell.waitForTimeout(2000);
    const fin2 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w._filoTabs).map((w) => { try { return w.webContents.getURL(); } catch (_) { return '?'; } }));
    console.log('DOPO LINK INTERNO', JSON.stringify(fin2), 'AVVISI', JSON.stringify(await avvisi()));
  }
});

test('SONDA: dopo «Apri comunque», la chip dei popup dello stesso sito', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const pop = rete.pagina('blocked.test', '/pop', '<h1>POPUP DEL SITO</h1>');
  const sito = rete.pagina('blocked.test', '/', `<h1>SITO</h1><button id="b" onclick="window.open('${pop}', 'p', 'width=400,height=300')">pop</button>`);
  await shell.evaluate((u) => window.filoShell.tabs.openBlockedPopup(u, true), sito);
  await shell.waitForTimeout(1500);
  const tab = app.windows().find((w) => w.url() === sito);
  const avvisi = await contaAvvisi(app);
  await tab.click('#b');
  const chip = shell.locator('.popup-chip').first();
  await expect(chip).toBeVisible({ timeout: 6000 });
  await chip.locator('button', { hasText: 'Apri' }).click();
  await shell.waitForTimeout(2000);
  console.log('CHIP DOPO SI', JSON.stringify(await schede(app)), 'AVVISI', JSON.stringify(await avvisi()));
});
