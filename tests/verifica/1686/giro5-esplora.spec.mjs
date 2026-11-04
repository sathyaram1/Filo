// Verifica #1686 giro 5: porte dei giri passati su «rimettimi la musica» e riapertura delle schede chiuse dalla chat.

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

test('la musica fermata e fatta ripartire in un attimo, poi chiusa mentre suona, vince su un video fermato dopo', async ({ app, shell, openTab, testServer }) => {
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

test('la musica chiusa e riaperta con la scorciatoia riparte lei, senza una seconda copia', async ({ app, shell, openTab, testServer }) => {
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

test('«riaprila» detto due volte non apre due copie della stessa scheda chiusa', async ({ app, shell, openTab, testServer }) => {
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
    await expect(chat.locator('.dash-bubble-filo', { hasText: `fatto ${k}` })).toBeVisible({ timeout: 20_000 });
  }
  expect((await schede(shell)).tabs.filter((t) => t.url === orche.url).length).toBe(1);
  await ripristina(app);
});

test('«stamattina» e «ieri sera» filtrano per data di chiusura, e il modello sa che giorno è', async ({ app, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const base = testServer.originPubblico;
  const ora = new Date();
  const oggi8 = new Date(ora.getFullYear(), ora.getMonth(), ora.getDate(), 8, 0, 0);
  const ieri21 = new Date(ora.getFullYear(), ora.getMonth(), ora.getDate() - 1, 21, 0, 0);
  const settimana = new Date(ora.getFullYear(), ora.getMonth(), ora.getDate() - 7, 10, 0, 0);
  await app.evaluate(async (_e, voci) => {
    for (const v of voci) await globalThis.SN_ARCHIVED_TABS.archive(v);
  }, [
    { url: `${base}/stamattina`, title: 'Pagina di stamattina', closedAt: oggi8.toISOString(), reason: 'manual' },
    { url: `${base}/ierisera`, title: 'Pagina di ieri sera', closedAt: ieri21.toISOString(), reason: 'manual' },
    { url: `${base}/vecchia`, title: 'Pagina vecchia', closedAt: settimana.toISOString(), reason: 'manual' },
  ]);
  const g = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'SCHEDE_CHIUSE', arguments: JSON.stringify({ da: g(oggi8) }) }] },
    { text: '', toolCalls: [{ id: 'f2', name: 'SCHEDE_CHIUSE', arguments: JSON.stringify({ da: `${g(ieri21)}T18:00`, a: `${g(ieri21)}T23:59` }) }] },
    { text: 'fine' },
  ]);
  await chiedi(chat, 'che schede ho chiuso stamattina e ieri sera?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'fine' })).toBeVisible({ timeout: 20_000 });
  const calls = await chiamateAlModello(app);
  const esito = (id) => { for (const m of calls) { const x = m.find((y) => y.role === 'tool' && y.tool_call_id === id); if (x) return String(x.content); } return ''; };
  const e1 = esito('f1');
  const e2 = esito('f2');
  expect(e1).toContain('Pagina di stamattina');
  expect(e1).not.toContain('Pagina di ieri sera');
  expect(e1).not.toContain('Pagina vecchia');
  expect(e2).toContain('Pagina di ieri sera');
  expect(e2).not.toContain('Pagina di stamattina');
  const sistema = JSON.stringify(calls[0]);
  expect(sistema, 'il modello deve sapere la data di oggi').toMatch(new RegExp(String(ora.getFullYear())));
  await ripristina(app);
});
