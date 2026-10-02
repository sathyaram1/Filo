// Verifica #590.2 giro 6, rilievo 1: un sito scritto nella lista passa per stati a metà, e uno di questi può
// essere il sito di una scheda aperta. La scheda non deve ricaricarsi mentre si scrive un altro sito.
import { test, expect, lista, apri, idAttiva, schedaSu } from '../../helpers/reteFinta.mjs';

const caricataSu = async (app, host) => ((await schedaSu(app, host)) || {}).caricata || '';

test('scrivendo «blocked.test.it» con una pausa dopo «blocked.test», la scheda aperta su blocked.test non viene portata via', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1><input id="campo">');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await app.evaluate(({ BrowserWindow }, i) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
    globalThis.__nav590 = [];
    t.view.webContents.on('did-navigate', (_e, u) => globalThis.__nav590.push(u));
  }, id);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await expect.poll(() => !!app.windows().find((w) => w.url().startsWith('filo://security')), { timeout: 8000 }).toBe(true);
  const pref = app.windows().find((w) => w.url().startsWith('filo://security'));
  const campo = pref.locator('#sec-siteblock-blacklist');
  await campo.waitFor({ timeout: 8000 });
  await pref.waitForTimeout(500);
  await campo.click();
  await pref.keyboard.type('blocked.test', { delay: 40 });
  await pref.waitForTimeout(1000);
  await pref.keyboard.type('.it', { delay: 40 });
  await pref.waitForTimeout(4500);
  expect(await campo.inputValue()).toBe('blocked.test.it');
  expect(await caricataSu(app, 'blocked.test')).toBe(sito);
  expect(await app.evaluate(() => globalThis.__nav590)).toEqual([]);
});
