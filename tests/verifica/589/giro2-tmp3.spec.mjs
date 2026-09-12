import { test, expect } from '../../fixtures/electron.mjs';

const CHIAVE = 'sk-or-v1-VERIFICA589-CHIAVE-SEGRETA';
const PWD = 'VERIFICA589-PASSWORD-PROXY';
const PROXY = `socks5://utente:${PWD}@gate.example.com:7000`;

const salva = (shell, settings) =>
  shell.evaluate((s) => window.filoShell.message({ type: 'update_settings', settings: s }), settings);

test('raffica', async ({ app, shell, openTab, testServer }) => {
  await salva(shell, { apiKeys: { openrouter: CHIAVE }, proxy: { datacenter: PROXY } });
  const web = await testServer.openReady(openTab, '<h1>pagina</h1>');
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__p = [];
    const win = BrowserWindow.getAllWindows()[0];
    const fr = win.webContents.mainFrame;
    const frP = Object.getPrototypeOf(fr);
    const frSend = frP.send;
    frP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast' && a[0] && a[0].type === 'settings_updated') {
        let u = ''; try { u = this.url; } catch (_) {}
        globalThis.__p.push({ url: u, keys: Object.keys(a[0].settings || {}), dump: JSON.stringify(a[0].settings || null).slice(0, 500) });
      }
      return frSend.call(this, ch, ...a);
    };
    const wcP = Object.getPrototypeOf(win.webContents);
    const wcSend = wcP.send;
    wcP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast' && a[0] && a[0].type === 'settings_updated') {
        let u = ''; try { u = this.getURL(); } catch (_) {}
        globalThis.__p.push({ url: 'WC ' + u, keys: Object.keys(a[0].settings || {}), dump: JSON.stringify(a[0].settings || null).slice(0, 500) });
      }
      return wcSend.call(this, ch, ...a);
    };
  });

  const lungo = 'x'.repeat(10000);
  for (let giro = 0; giro < 4; giro++) {
    const cattivi = [
      { theme: 'light' }, { theme: '   ' }, { blocklist: [] },
      { blocklist: [lungo, '', '   ', '<script>alert(1)</script>', '😀.example', 'a b'] },
      { apiKeys: { openrouter: CHIAVE + '-BIS' } },
      { proxy: { datacenter: PROXY, extra: { nascosto: CHIAVE } } },
      { tts: { voice: '😀'.repeat(500), rate: Number.NaN, pitch: -1 } },
      { themeTokens: { accent: '#112233' } },
    ];
    await Promise.all(cattivi.map((s) => salva(shell, s).catch(() => null)));
  }
  await web.waitForTimeout(1500);
  const tutte = await app.evaluate(() => globalThis.__p || []);
  const colpevoli = tutte.filter((c) => /^(WC )?https?:/.test(c.url) && c.dump.includes('VERIFICA589'));
  console.log('>>> consegne totali', tutte.length, 'verso web', tutte.filter((c) => /^(WC )?https?:/.test(c.url)).length);
  for (const c of colpevoli) console.log('>>> COLPEVOLE', c.url, JSON.stringify(c.keys), c.dump.slice(0, 300));
  expect(colpevoli.length).toBe(0);
});
