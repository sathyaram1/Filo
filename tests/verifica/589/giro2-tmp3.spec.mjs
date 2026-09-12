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
    globalThis.__dec = [];
    const S = globalThis.SN_SETTINGS_SCOPE;
    const orig = S.isFiloOrigin;
    S.isFiloOrigin = function (u) { const r = orig.call(this, u); globalThis.__dec.push([String(u), r]); return r; };
    const win = BrowserWindow.getAllWindows()[0];
    const fr = win.webContents.mainFrame;
    const frP = Object.getPrototypeOf(fr);
    const frSend = frP.send;
    frP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast' && a[0] && a[0].type === 'settings_updated') {
        let u = ''; try { u = this.url; } catch (_) {}
        const d = JSON.stringify(a[0].settings || null);
        globalThis.__p.push({ via: 'frame', url: u, keys: Object.keys(a[0].settings || {}).length, seg: d.includes('VERIFICA589') });
      }
      return frSend.call(this, ch, ...a);
    };
    const wcP = Object.getPrototypeOf(win.webContents);
    const wcSend = wcP.send;
    wcP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast' && a[0] && a[0].type === 'settings_updated') {
        let u = ''; try { u = this.getURL(); } catch (_) {}
        const d = JSON.stringify(a[0].settings || null);
        globalThis.__p.push({ via: 'wc', url: u, keys: Object.keys(a[0].settings || {}).length, seg: d.includes('VERIFICA589') });
      }
      return wcSend.call(this, ch, ...a);
    };
  });

  const lungo = 'x'.repeat(10000);
  const cattivi = [
    { theme: 'light' }, { theme: '   ' }, { blocklist: [] },
    { blocklist: [lungo, '', '   ', '<script>alert(1)</script>', '😀.example', 'a b'] },
    { apiKeys: { openrouter: CHIAVE + '-BIS' } },
    { proxy: { datacenter: PROXY, extra: { nascosto: CHIAVE } } },
    { tts: { voice: '😀'.repeat(500), rate: Number.NaN, pitch: -1 } },
    { themeTokens: { accent: '#112233' } },
  ];
  await Promise.all(cattivi.map((s) => salva(shell, s).catch(() => null)));
  await web.waitForTimeout(1200);
  const { tutte, dec } = await app.evaluate(() => ({ tutte: globalThis.__p || [], dec: globalThis.__dec || [] }));
  const colpevoli = tutte.filter((c) => /^https?:/.test(c.url) && c.seg);
  console.log('>>> consegne', tutte.length, 'colpevoli', colpevoli.length);
  for (const c of colpevoli) console.log('>>> COLPEVOLE', JSON.stringify(c));
  if (colpevoli.length) console.log('>>> DECISIONI', JSON.stringify(dec.slice(0, 60)));
  expect(colpevoli.length).toBe(0);
});
