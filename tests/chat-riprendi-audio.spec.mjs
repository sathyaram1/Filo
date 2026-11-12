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

const lettoreInCorsa = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows()
  .find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.title === 'Musica')._mediaInCorso);

// Ha suonato e poi si è fermata: l'utente l'ha messa in pausa. Il lettore parte davvero (media-started-playing):
// solo dopo il motore lo sente.
async function ascoltataEFermata(app, page, url) {
  await page.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => lettoreInCorsa(app)).toBe(true);
  await suona(app, 'Musica', true);
  await page.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Musica', false);
  await expect.poll(() => inPausa(app, url)).toBe(true);
}

test('un suono senza lettore in corsa (una notifica, un video muto) non fa di una scheda la musica da riprendere', async ({ app, openTab, testServer }) => {
  await home(app);
  await openTab(testServer.html('<title>Posta</title><p>posta'));
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((x) => x.title === 'Posta').view.webContents;
    wc.emit('audio-state-changed', { audible: true });
    wc.emit('audio-state-changed', { audible: false });
  });
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.title === 'Posta').audioAt || null)).toBeNull();
});

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

test('la musica chiusa mentre suonava vince su un video fermato dopo che lei era partita', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const inCorsa = (titolo) => app.evaluate(({ BrowserWindow }, t) => !!BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.title === t)?._mediaInCorso, titolo);
  const musica = await openTab(testServer.html(MUSICA));
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa('Musica')).toBe(true);
  await suona(app, 'Musica', true);

  // Mentre la musica va, un video con l'audio in un'altra scheda, sentito e fermato.
  await chat.waitForTimeout(1500);
  const video = await openTab(testServer.html(MUSICA.replace('<title>Musica</title>', '<title>Video</title>')));
  await video.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa('Video')).toBe(true);
  await suona(app, 'Video', true);
  await video.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Video', false);
  await expect.poll(() => video.evaluate(() => window.__statoAudio().pausa)).toBe(true);

  // La scheda della musica si chiude mentre suona ancora.
  await chat.waitForTimeout(1500);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), (await schede(shell)).tabs.find((t) => t.url === url).id);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r5', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');

  await expect(chat.locator('.dash-activity').last()).toContainText('Riaperta e ripartita', { timeout: 20_000 });
  await expect(chat.locator('.dash-activity').last()).toContainText('Musica');
  expect((await schede(shell)).tabs.filter((t) => t.url === url).length).toBe(1);
  expect(await video.evaluate(() => window.__statoAudio().pausa)).toBe(true);
  await ripristina(app);
});

test('la musica fermata e ripartita in un attimo (o al brano dopo), poi chiusa mentre suona, vince su un video fermato dopo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const inCorsa = (titolo) => app.evaluate(({ BrowserWindow }, t) => !!BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.title === t)?._mediaInCorso, titolo);
  const musica = await openTab(testServer.html(MUSICA));
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa('Musica')).toBe(true);
  await suona(app, 'Musica', true);
  // Pausa breve: il motore la sente ancora e non ridice «suona».
  await musica.evaluate(() => document.getElementById('a').pause());
  await expect.poll(() => inCorsa('Musica')).toBe(false);
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa('Musica')).toBe(true);

  await chat.waitForTimeout(1500);
  const video = await openTab(testServer.html(MUSICA.replace('<title>Musica</title>', '<title>Video</title>')));
  await video.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa('Video')).toBe(true);
  await suona(app, 'Video', true);
  await video.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Video', false);

  await chat.waitForTimeout(1500);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), (await schede(shell)).tabs.find((t) => t.url === url).id);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r9', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
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
  await expect.poll(() => lettoreInCorsa(app)).toBe(true);
  await suona(app, 'Musica', true);
  await chat.waitForTimeout(500);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), (await schede(shell)).tabs.find((t) => t.url === url).id);
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_ARCHIVED_TABS.listMeta()).some((t) => t.url === u), url), { timeout: 10_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riapriChiusa());
  await expect.poll(async () => (await schede(shell)).tabs.filter((t) => t.url === url).length, { timeout: 10_000 }).toBe(1);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r10', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  const suonaUna = async () => {
    for (const w of app.windows()) {
      try { if (w.url() === url && !(await w.evaluate(() => window.__statoAudio().pausa))) return true; } catch (_) {}
    }
    return false;
  };
  await expect(chat.locator('.dash-activity').last()).toContainText('Musica', { timeout: 20_000 });
  await expect.poll(suonaUna, { timeout: 15_000 }).toBe(true);
  await chat.waitForTimeout(1500);
  expect((await schede(shell)).tabs.filter((t) => t.url === url).length, 'una sola scheda della musica').toBe(1);
  await ripristina(app);
});

test('«metti in pausa la musica» ferma la scheda che suona, senza chiuderla; «rimettimi la musica e portamici» la fa ripartire davanti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => lettoreInCorsa(app)).toBe(true);
  await suona(app, 'Musica', true);
  await expect.poll(() => inPausa(app, url)).toBe(false);
  const idHome = await tornaAllaHome(shell);
  const prima = (await schede(shell)).tabs.length;

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'p1', name: 'PAUSA_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'metti in pausa la musica');
  await expect.poll(() => inPausa(app, url), { timeout: 15_000 }).toBe(true);
  await expect(chat.locator('.dash-activity').last()).toContainText('In pausa', { timeout: 10_000 });
  expect((await schede(shell)).tabs.length).toBe(prima);
  expect((await schede(shell)).activeId).toBe(idHome);
  await suona(app, 'Musica', false);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'p2', name: 'RIPRENDI_AUDIO', arguments: '{"vai":true}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica e portamici');
  await expect.poll(() => inPausa(app, url), { timeout: 15_000 }).toBe(false);
  const dopo = await schede(shell);
  expect(dopo.tabs.length).toBe(prima);
  expect(dopo.tabs.find((t) => t.id === dopo.activeId).url).toBe(url);
  await ripristina(app);
});

test('«portami alla musica» mette davanti la scheda già aperta col suo numero nella barra, senza aprirne un doppione', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  const url = musica.url();
  await openTab(testServer.html('<title>Lettura</title><p>lettura'));
  await tornaAllaHome(shell);
  const prima = await schede(shell);
  const numero = prima.tabs.findIndex((t) => t.url === url) + 1;

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'm1', name: 'MOSTRA_SCHEDA', arguments: JSON.stringify({ scheda: numero }) }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'portami alla musica');
  await expect.poll(async () => { const s = await schede(shell); return s.tabs.find((t) => t.id === s.activeId)?.url; }, { timeout: 15_000 }).toBe(url);
  expect((await schede(shell)).tabs.length).toBe(prima.tabs.length);
  const prompt = JSON.stringify((await chiamateAlModello(app))[0]);
  expect(prompt, 'il numero è quello della barra che il modello legge').toContain(`${numero}. Musica`);
  await ripristina(app);
});

// Come dopo un riavvio: la memoria delle schede chiuse della sessione è vuota, resta l'archivio.
const dimenticaLaSessione = (app) => app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs._pilaChiuse().dimentica(null);
});

test('dopo un riavvio la musica chiusa si ritrova dall\'archivio, riaperta allo stesso indirizzo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  const url = musica.url();
  await ascoltataEFermata(app, musica, url);
  const id = (await schede(shell)).tabs.find((t) => t.url === url).id;
  await shell.evaluate((x) => window.filoShell.tabs.close(x), id);
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_ARCHIVED_TABS.listMeta())
    .some((t) => t.url === u && Date.parse(t.audioAt) > 0), url), { timeout: 10_000 }).toBe(true);
  await dimenticaLaSessione(app);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r6', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect.poll(async () => (await schede(shell)).tabs.filter((t) => t.url === url).length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => inPausa(app, url), { timeout: 15_000 }).toBe(false);
  await expect(chat.locator('.dash-activity').last()).toContainText('Riaperta e ripartita', { timeout: 10_000 });
  await ripristina(app);
});

test('riaperto Filo, la scheda rimessa dalla sessione salvata sa di aver suonato e riparte lei, senza un doppione', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  const url = musica.url();
  await ascoltataEFermata(app, musica, url);
  // La sessione come la salva Filo alla chiusura, poi la scheda se ne va e la riapertura la rilegge.
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const s = tm.sessionState();
    const i = s.tabs.indexOf(u);
    const solo = (k) => (Array.isArray(s[k]) ? [s[k][i]] : undefined);
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), {
      tabs: [u], activeIndex: 0, colors: solo('colors'), aperte: solo('aperte'), pagine: solo('pagine'), usate: solo('usate'), audio: solo('audio'),
    });
    tm.closeTab(tm.tabs.find((t) => t.url === u).id);
  }, url);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  // Aperta alla chiusura di Filo, la scheda sta nella sessione salvata e non nell'archivio.
  await app.evaluate(async (_e, u) => {
    const A = globalThis.SN_ARCHIVED_TABS;
    await A.removeMany((await A.listMeta()).filter((t) => t.url === u).map((t) => t.id));
  }, url);
  await dimenticaLaSessione(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.restoreSession());
  await expect.poll(async () => (await schede(shell)).tabs.filter((t) => t.url === url).length, { timeout: 10_000 }).toBe(1);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r7', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  // La pagina chiusa può restare un attimo fra le finestre di Playwright: conta quella che suona.
  const suonaUna = async () => {
    for (const w of app.windows()) {
      try { if (w.url() === url && !(await w.evaluate(() => window.__statoAudio().pausa))) return true; } catch (_) {}
    }
    return false;
  };
  await expect.poll(suonaUna, { timeout: 15_000 }).toBe(true);
  const prompt = JSON.stringify((await chiamateAlModello(app))[0]);
  // Rinviata, non ha ancora il titolo: nell'elenco c'è il suo indirizzo.
  expect(prompt, 'la scheda rimessa porta l\'ora in cui suonava, letta dalla sessione').toMatch(/\[AUDIO FERMO\] (Musica|127\.0\.0\.1)/);
  await expect(chat.locator('.dash-activity').last()).toContainText('Ripartita', { timeout: 10_000 });
  expect((await schede(shell)).tabs.filter((t) => t.url === url).length).toBe(1);
  await ripristina(app);
});

test('«fai ripartire la scheda tre» riprende quella col suo numero nella barra, non l\'ultima che ha suonato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const musica = await testServer.openReady(openTab, MUSICA);
  const url = musica.url();
  await ascoltataEFermata(app, musica, url);
  await openTab(testServer.html('<title>Lettura</title><p>lettura'));
  await tornaAllaHome(shell);
  const numero = (await schede(shell)).tabs.findIndex((t) => t.url === url) + 1;
  // Un'altra scheda ha suonato dopo: senza numero vincerebbe lei.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs.find((x) => x.title === 'Lettura').audioAt = Date.now() + 60_000;
  });

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'r8', name: 'RIPRENDI_AUDIO', arguments: JSON.stringify({ scheda: numero }) }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, `fai ripartire la scheda ${numero}`);
  await expect.poll(() => inPausa(app, url), { timeout: 15_000 }).toBe(false);
  await expect(chat.locator('.dash-activity').last()).toContainText('Musica', { timeout: 10_000 });
  await ripristina(app);
});
