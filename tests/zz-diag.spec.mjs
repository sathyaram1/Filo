import { test, expect } from './fixtures/electron.mjs';

test('diag revoca da incognito', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const origine = 'https://due-memorie.test';
  await app.evaluate(async (_e, o) => {
    await globalThis.SN_HANDLE_MESSAGE(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { security: { sitePermissions: { [o]: { microfono: 'allow' } } } } },
      { url: 'filo://security/security.html' },
    );
  }, origine);
  await app.evaluate(() => { globalThis.__diagSalva = []; });

  await shell.evaluate(() => window.filoShell.openIncognito());
  let si = null; const f = Date.now() + 15000;
  while (Date.now() < f && !si) { si = app.windows().find((w) => { try { return w.url().includes('incognito=1'); } catch (_) { return false; } }) || null; if (!si) await new Promise((r) => setTimeout(r, 200)); }
  await si.waitForFunction(() => !!window.filoShell, null, { timeout: 8000 });
  await si.evaluate(() => window.filoShell.tabs.open('filo://security/'));
  let sec = null; const f2 = Date.now() + 15000;
  while (Date.now() < f2 && !sec) { sec = app.windows().find((w) => { try { return w.url().startsWith('filo://security/'); } catch (_) { return false; } }) || null; if (!sec) await new Promise((r) => setTimeout(r, 150)); }
  await sec.waitForSelector('#perms-list', { timeout: 8000 });
  await app.evaluate(() => {
    globalThis.__scritture = [];
    const S = globalThis.SN_STORAGE;
    const vero = S.setSettings;
    S.setSettings = async function (s) {
      globalThis.__scritture.push({
        n: Object.keys(((s || {}).security || {}).sitePermissions || {}).length,
        stack: new Error('x').stack.split('\n').slice(1, 7).join(' | '),
      });
      return vero.call(this, s);
    };
  });
  const riga = sec.locator('#perms-list li').filter({ hasText: 'due-memorie.test' }).first();
  await riga.locator('button').nth(1).click();
  await sec.waitForTimeout(2000);
  console.log('[diag] salva:', JSON.stringify(await app.evaluate(() => globalThis.__diagSalva)));
  console.log('[diag] scritture:', JSON.stringify(await app.evaluate(() => globalThis.__scritture), null, 1));
  console.log('[diag] disco:', JSON.stringify(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.sitePermissions)));
  expect(true).toBe(true);
});
