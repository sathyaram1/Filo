// Verifica #1686 giro 5: r1 la musica fermata un attimo perde il suo «suonava adesso»; r2 una scheda chiusa già tornata
// aperta per la chat resta chiusa, e riaprirla ne fa una seconda copia.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

const MUSICA = `<!doctype html><title>Musica</title><audio id="a" loop></audio><div id="stato">fermo</div>
<script>
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
  window.__statoAudio = () => ({ pausa: a.paused, tempo: a.currentTime });
</script>`;

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()));
async function tornaAllaHome(shell) {
  const s = await schede(shell);
  const h = s.tabs.find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
  return h.id;
}
const suona = (app, titolo, audible) => app.evaluate(({ BrowserWindow }, [t, a]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.tabs.find((x) => x.title === t).view.webContents.emit('audio-state-changed', { audible: a });
}, [titolo, audible]);
const inCorsa = (app, titolo) => app.evaluate(({ BrowserWindow }, t) => !!BrowserWindow.getAllWindows()
  .find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.title === t)?._mediaInCorso, titolo);
const suonaUna = async (app, url) => {
  for (const w of app.windows()) {
    try { if (w.url() === url && !(await w.evaluate(() => window.__statoAudio().pausa))) return true; } catch (_) {}
  }
  return false;
};

test('r1 la musica fermata e fatta ripartire in un attimo, poi chiusa mentre suona, vince su un video fermato dopo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await openTab(testServer.html(MUSICA));
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);
  await suona(app, 'Musica', true);
  // Pausa breve (o cambio di brano): il motore continua a sentirla, nessun nuovo «suona».
  await musica.evaluate(() => document.getElementById('a').pause());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(false);
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);

  await chat.waitForTimeout(1500);
  const video = await openTab(testServer.html(MUSICA.replace('<title>Musica</title>', '<title>Video</title>')));
  await video.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Video')).toBe(true);
  await suona(app, 'Video', true);
  await video.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Video', false);

  await chat.waitForTimeout(1500);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), (await schede(shell)).tabs.find((t) => t.url === url).id);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'g1', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'fine' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect(chat.locator('.dash-activity').last()).toContainText('Musica', { timeout: 20_000 });
  expect((await schede(shell)).tabs.filter((t) => t.url === url).length).toBe(1);
  expect(await video.evaluate(() => window.__statoAudio().pausa)).toBe(true);
  await ripristina(app);
});

test('r2 la musica chiusa e riaperta con la scorciatoia riparte lei, senza una seconda copia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);
  await suona(app, 'Musica', true);
  await chat.waitForTimeout(500);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), (await schede(shell)).tabs.find((t) => t.url === url).id);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_ARCHIVED_TABS.listMeta()).some((t) => t.url === u), url), { timeout: 10_000 }).toBe(true);
  // Ctrl/Cmd+Shift+T
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riapriChiusa());
  await expect.poll(async () => (await schede(shell)).tabs.filter((t) => t.url === url).length, { timeout: 10_000 }).toBe(1);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'g2', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'fine' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect(chat.locator('.dash-activity').last()).toContainText('Musica', { timeout: 20_000 });
  await expect.poll(() => suonaUna(app, url), { timeout: 15_000 }).toBe(true);
  await chat.waitForTimeout(1500);
  expect((await schede(shell)).tabs.filter((t) => t.url === url).length, 'una sola scheda della musica').toBe(1);
  await ripristina(app);
});

test('r2 «riaprila» detto due volte non apre due copie della stessa scheda chiusa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  await openTab(testServer.html('<title>Le orche del Mediterraneo</title><p>orche', { pubblico: true }));
  await tornaAllaHome(shell);
  const orche = (await schede(shell)).tabs.find((x) => x.title === 'Le orche del Mediterraneo');
  await shell.evaluate((id) => window.filoShell.tabs.close(id), orche.id);
  let idArch = null;
  await expect.poll(async () => {
    const e = (await app.evaluate(async () => globalThis.SN_ARCHIVED_TABS.listMeta())).find((t) => t.url === orche.url);
    idArch = e ? e.id : null; return !!idArch;
  }, { timeout: 10_000 }).toBe(true);

  for (const k of [1, 2]) {
    await modelloFinto(app, [
      { text: '', toolCalls: [{ id: `d${k}`, name: 'RIAPRI_SCHEDA', arguments: JSON.stringify({ id: idArch }) }] },
      { text: `fatto ${k}` },
    ]);
    await tornaAllaHome(shell);
    await chiedi(chat, 'riaprimi la pagina sulle orche');
    await expect(chat.locator('.dash-activity', { hasText: 'Riaperta' })).toHaveCount(k, { timeout: 20_000 });
    await expect(chat.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  }
  await chat.waitForTimeout(1500);
  expect((await schede(shell)).tabs.filter((t) => t.url === orche.url).length, 'una sola scheda delle orche').toBe(1);
  await ripristina(app);
});
