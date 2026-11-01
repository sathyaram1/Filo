// #1397 — «rimettimi la musica» detto alla chat fa ripartire la scheda che suonava (anche riaperta all'avvio, col blocco
// dell'autoplay) o, se è stata chiusa, la riapre allo stesso indirizzo; non apre una ricerca nuova. In headless non
// suona niente: `audible` lo dà il test con lo stesso evento del motore (audio-state-changed). Il modello è finto.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';

// Un lettore con 30 secondi di silenzio in WAV generato al volo, fermo finché qualcuno non preme play.
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

// Il motore dice che la scheda suona (o tace), come farebbe con l'audio vero.
const suona = (app, titolo, audible) => app.evaluate(({ BrowserWindow }, [t, a]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.tabs.find((x) => x.title === t).view.webContents.emit('audio-state-changed', { audible: a });
}, [titolo, audible]);

const paginaMusica = (app, url) => app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;

const inPausa = async (app, url) => {
  const p = paginaMusica(app, url);
  if (!p) return null;
  try { return await p.evaluate(() => window.__statoAudio().pausa); } catch (_) { return null; }
};

const esitoPerIlModello = async (app, id) => {
  for (const msgs of await chiamateAlModello(app)) {
    const m = msgs.find((x) => x.role === 'tool' && x.tool_call_id === id);
    if (m) return String(m.content);
  }
  return '';
};

// Ha suonato e poi si è fermata: l'utente l'ha messa in pausa.
async function ascoltataEFermata(app, page, url) {
  await page.evaluate(() => document.getElementById('a').play());
  await suona(app, 'Musica', true);
  await page.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Musica', false);
  await expect.poll(() => inPausa(app, url)).toBe(true);
}

test('la scheda in pausa riparte, dietro, senza aprirne una nuova; il modello la vede segnata', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  const url = musica.url();
  await ascoltataEFermata(app, musica, url);
  await openTab(testServer.html('<title>Lettura</title><p>lettura'));
  const idHome = await tornaAllaHome(shell);
  const prima = (await schede(shell)).tabs.length;

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r1', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');

  await expect.poll(() => inPausa(app, url), { timeout: 15_000 }).toBe(false);
  const dopo = await schede(shell);
  expect(dopo.tabs.length).toBe(prima);
  expect(dopo.activeId, 'la musica riparte dietro: la chat resta davanti').toBe(idHome);
  const prompt = JSON.stringify((await chiamateAlModello(app))[0]);
  expect(prompt).toMatch(/\[AUDIO FERMO\] Musica/);
  expect(prompt).toContain('RIPRENDI_AUDIO');
  const riga = chat.locator('.dash-activity').last();
  await expect(riga).toContainText('Ripartita', { timeout: 10_000 });
  await expect(riga).toContainText('Musica');
  // Riuscita parla da sé: una chiamata sola al modello.
  expect((await chiamateAlModello(app)).length).toBe(1);
  await ripristina(app);
});

test('chiusa, la scheda che suonava si riapre allo stesso indirizzo e riparte', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  const url = musica.url();
  await ascoltataEFermata(app, musica, url);
  const id = (await schede(shell)).tabs.find((t) => t.url === url).id;
  await shell.evaluate((x) => window.filoShell.tabs.close(x), id);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r2', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');

  await expect.poll(async () => (await schede(shell)).tabs.filter((t) => t.url === url).length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => inPausa(app, url), { timeout: 15_000 }).toBe(false);
  await expect(chat.locator('.dash-activity').last()).toContainText('Riaperta e ripartita', { timeout: 10_000 });
  await ripristina(app);
});

test('una scheda riaperta all\'avvio, col blocco dell\'autoplay, riparte lo stesso', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const url = testServer.html(MUSICA);
  // Come la riapertura della sessione: blocco dell'autoplay e l'ora in cui suonava letta dalla sessione salvata.
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const id = tm.openTab(u, { activate: false, suppressAutoplay: true, origine: { tipo: 'filo' } });
    tm.tabs.find((t) => t.id === id).audioAt = Date.now() - 3600_000;
  }, url);
  await expect.poll(() => paginaMusica(app, url) !== null, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => inPausa(app, url), { timeout: 10_000 }).toBe(true);
  // La sessione salvata ricorda quando ha suonato.
  const sessione = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.sessionState());
  expect(sessione.audio[sessione.tabs.indexOf(url)]).toMatch(/^\d{4}-\d\d-\d\dT/);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r3', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect.poll(() => inPausa(app, url), { timeout: 15_000 }).toBe(false);
  // Resta in riproduzione: il blocco non la rimette in pausa un attimo dopo.
  await chat.waitForTimeout(800);
  expect(await inPausa(app, url)).toBe(false);
  await ripristina(app);
});

test('se niente ha suonato non apre niente e il modello deve chiedere', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await openTab(testServer.html('<title>Lettura</title><p>lettura'));
  await tornaAllaHome(shell);
  const prima = (await schede(shell)).tabs.length;
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r4', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Cosa vuoi ascoltare?' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Cosa vuoi ascoltare?' })).toBeVisible({ timeout: 15_000 });
  expect((await schede(shell)).tabs.length).toBe(prima);
  const esito = await esitoPerIlModello(app, 'r4');
  expect(esito).toContain('Niente da far ripartire');
  expect(esito).toContain('Chiedi all\'utente');
  await ripristina(app);
});
