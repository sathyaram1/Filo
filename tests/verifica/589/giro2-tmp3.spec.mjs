import { test, expect } from '../../fixtures/electron.mjs';

const CHIAVE = 'sk-or-v1-VERIFICA589-CHIAVE-SEGRETA';
const PWD = 'VERIFICA589-PASSWORD-PROXY';
const PROXY = `socks5://utente:${PWD}@gate.example.com:7000`;

const salva = (shell, settings) =>
  shell.evaluate((s) => window.filoShell.message({ type: 'update_settings', settings: s }), settings);

test('raffica', async ({ app, shell, openTab, testServer }) => {
  await salva(shell, { apiKeys: { openrouter: CHIAVE, gemini: CHIAVE }, proxy: { datacenter: PROXY, residential: PROXY } });
  const web = await testServer.openReady(openTab, '<h1>pagina</h1><textarea>scrivi</textarea>');
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__p = [];
    const nota = (via, url, m) => {
      if (!m || m.type !== 'settings_updated') return;
      let alVolo = '';
      try { alVolo = JSON.stringify(m.settings ?? null); } catch (_) { alVolo = '?'; }
      globalThis.__p.push({
        via,
        url: String(url || ''),
        segAlVolo: alVolo.includes('VERIFICA589'),
        chiaviAlVolo: Object.keys(m.settings || {}).join(','),
        settings: m.settings, // per riferimento, come nella prova del giro 1
      });
    };
    const win = BrowserWindow.getAllWindows()[0];
    const frP = Object.getPrototypeOf(win.webContents.mainFrame);
    const frSend = frP.send;
    frP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast') { let u = ''; try { u = this.url; } catch (_) {} nota('frame', u, a[0]); }
      return frSend.call(this, ch, ...a);
    };
    const wcP = Object.getPrototypeOf(win.webContents);
    const wcSend = wcP.send;
    wcP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast') { let u = ''; try { u = this.getURL(); } catch (_) {} nota('wc', u, a[0]); }
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

  const tutte = await app.evaluate(() => (globalThis.__p || []).map((c) => ({
    via: c.via, url: c.url, segAlVolo: c.segAlVolo, chiaviAlVolo: c.chiaviAlVolo,
    segDopo: JSON.stringify(c.settings ?? null).includes('VERIFICA589'),
    chiaviDopo: Object.keys(c.settings || {}).join(','),
  })));
  const web1 = tutte.filter((c) => /^https?:/.test(c.url));
  const sospetti = web1.filter((c) => c.segAlVolo || c.segDopo);
  console.log('>>> verso web', web1.length, 'sospetti', sospetti.length);
  for (const c of sospetti) console.log('>>> SOSPETTO', JSON.stringify(c).slice(0, 400));
  expect(sospetti.length).toBe(0);
});
