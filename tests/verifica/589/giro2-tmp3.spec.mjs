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
    globalThis.__dec = [];
    const S = globalThis.SN_SETTINGS_SCOPE;
    const orig = S.isFiloOrigin;
    S.isFiloOrigin = function (u) {
      const r = orig.call(this, u);
      globalThis.__dec.push({ t: Date.now(), u: String(u), r });
      return r;
    };
    const nota = (via, url, m) => {
      if (!m || m.type !== 'settings_updated') return;
      let s = ''; try { s = JSON.stringify(m.settings ?? null); } catch (_) { s = '?'; }
      globalThis.__p.push({
        t: Date.now(), via, url: String(url || ''),
        segAlVolo: s.includes('VERIFICA589'),
        chiavi: Object.keys(m.settings || {}).join(','),
        settings: m.settings,
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
    globalThis.__finestre = () => BrowserWindow.getAllWindows().map((w) => { try { return w.webContents.getURL(); } catch (_) { return '?'; } });
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
  await web.waitForTimeout(1000);

  const res = await app.evaluate(() => ({
    finestre: globalThis.__finestre(),
    dec: globalThis.__dec,
    p: (globalThis.__p || []).map((c) => ({
      t: c.t, via: c.via, url: c.url, segAlVolo: c.segAlVolo, chiavi: c.chiavi.slice(0, 60),
      segDopo: JSON.stringify(c.settings ?? null).includes('VERIFICA589'),
    })),
  }));
  const web1 = res.p.filter((c) => /^https?:/.test(c.url));
  const sospetti = web1.filter((c) => c.segAlVolo || c.segDopo);
  if (sospetti.length) {
    console.log('>>> FINESTRE', JSON.stringify(res.finestre));
    for (const c of sospetti) {
      console.log('>>> SOSPETTO', JSON.stringify(c));
      console.log('>>> DECISIONI VICINE', JSON.stringify(res.dec.filter((d) => Math.abs(d.t - c.t) <= 40)));
    }
  }
  console.log('>>> web', web1.length, 'sospetti', sospetti.length);
  expect(sospetti.length).toBe(0);
});
