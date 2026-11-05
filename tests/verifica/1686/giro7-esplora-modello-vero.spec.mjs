// Esplorazione col modello vero (si cancella): le frasi della segnalazione dette alla chat della home.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, chiedi } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';

const KEY = process.env.OPENROUTER_API_KEY || '';
const PUBBLICO = { pubblico: true };
const snap = (shell) => shell.evaluate(async () => window.filoShell.tabs.snapshot());
const pagineWeb = async (shell) => (await snap(shell)).tabs.filter((t) => !String(t.url).startsWith('filo://')).map((t) => t.title);

async function tornaAllaHome(shell) {
  const h = (await snap(shell)).tabs.find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
  return h.id;
}

async function vero(app) {
  await app.evaluate(async (_e, k) => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } });
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__usate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      const r = await orig(o);
      globalThis.__usate.push({ model: r.model, text: String(r.text || '').slice(0, 300), calls: (r.toolCalls || []).map((c) => `${c.name} ${c.arguments}`) });
      return r;
    };
  }, KEY);
}
const usate = (app) => app.evaluate(() => globalThis.__usate);

async function fine(page) {
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(4000);
    if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'ok').catch(() => {});
  }
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

const MUSICA = `<!doctype html><title>Musica</title><audio id="a" loop></audio><script>
  const dur = 30, rate = 8000, n = dur * rate;
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  const a = document.getElementById('a');
  a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  window.__pausa = () => a.paused;
</script>`;

test.skip(!KEY, 'senza chiave');

test('chiudi la seconda scheda, poi tutte quelle di un sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await home(app);
  await vero(app);
  await openTab(testServer.html('<title>Ricetta</title><p>ricetta', PUBBLICO));
  await openTab(testServer.html('<title>Notizie</title><p>notizie'));
  const meteo = await openTab(testServer.html('<title>Meteo</title><p>meteo', PUBBLICO));
  await meteo.locator('p').click();
  await tornaAllaHome(shell);
  await chiedi(page, 'chiudi la seconda scheda');
  await fine(page);
  console.log('SECONDA', JSON.stringify(await usate(app)), JSON.stringify(await pagineWeb(shell)));
  await chiedi(page, 'chiudi tutte le schede di sito-pubblico.test');
  await fine(page);
  console.log('SITO', JSON.stringify(await usate(app)), JSON.stringify(await pagineWeb(shell)));
});

test('rimettimi la musica', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await home(app);
  await vero(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  await musica.evaluate(() => document.getElementById('a').play());
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs.find((x) => x.title === 'Musica').view.webContents.emit('audio-state-changed', { audible: true });
  });
  await musica.evaluate(() => document.getElementById('a').pause());
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs.find((x) => x.title === 'Musica').view.webContents.emit('audio-state-changed', { audible: false });
  });
  await openTab(testServer.html('<title>Lettura</title><p>lettura'));
  await tornaAllaHome(shell);
  const prima = (await snap(shell)).tabs.length;
  await chiedi(page, 'mi rimetti la musica?');
  await fine(page);
  console.log('MUSICA', JSON.stringify(await usate(app)), prima, (await snap(shell)).tabs.length, await musica.evaluate(() => window.__pausa()));
});

test('riaprimi la pagina sulle orche e cosa ha archiviato la pulizia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await home(app);
  await vero(app);
  await livelloAutonomia(app, 'default');
  await openTab(testServer.html('<title>Le orche del Mediterraneo</title><p>orche', PUBBLICO));
  await openTab(testServer.html('<title>Notizie di ieri</title><p>notizie', PUBBLICO));
  await openTab(testServer.html('<title>Lettura</title><p>resta', PUBBLICO));
  await tornaAllaHome(shell);
  const per = async (t) => (await snap(shell)).tabs.find((x) => x.title === t);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), (await per('Le orche del Mediterraneo')).id);
  await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((x, i) => ({ i, action: /Notizie/.test(x.title) ? 'archive' : 'keep', reason: 'già lette' })),
    });
    await BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.runAutoTriage({ trigger: 'idle' });
  });
  await chiedi(page, 'riaprimi la pagina sulle orche che ho chiuso');
  await fine(page);
  console.log('ORCHE', JSON.stringify(await usate(app)), JSON.stringify(await pagineWeb(shell)));
  await chiedi(page, 'cosa hai archiviato oggi con la pulizia?');
  await fine(page);
  console.log('PULIZIA', JSON.stringify(await usate(app)));
});

test('riordinami le tab', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await home(app);
  await vero(app);
  await livelloAutonomia(app, 'default');
  await openTab(testServer.html('<title>Vecchia</title><p>vecchia'));
  await openTab(testServer.html('<title>Utile</title><p>utile'));
  await tornaAllaHome(shell);
  await app.evaluate(() => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((x, i) => ({ i, action: x.title === 'Vecchia' ? 'archive' : 'keep', reason: 'test' })),
    });
  });
  await chiedi(page, 'riordinami le tab');
  await fine(page);
  console.log('RIORDINO', JSON.stringify(await usate(app)), JSON.stringify(await pagineWeb(shell)),
    await page.locator('.dash-activity').last().innerText().catch(() => ''));
});
