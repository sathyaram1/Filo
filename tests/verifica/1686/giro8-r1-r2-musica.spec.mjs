// Verifica #1686 giro 8: «rimettimi la musica» quando la pagina della musica ha un secondo lettore che si ferma mentre
// lei suona, e quando nella scheda della musica si è passati a un'altra pagina. Modello finto, audio dato dal test.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const lettore = (titolo, secondo = false) => `<!doctype html><title>${titolo}</title><audio id="a" loop></audio>${secondo ? '<audio id="b" loop></audio>' : ''}
<script>
  const dur = 30, rate = 8000, n = dur * rate;
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  const src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  for (const el of document.querySelectorAll('audio')) el.src = src;
  window.__statoAudio = () => ({ pausa: document.getElementById('a').paused });
</script>`;

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()));

async function tornaAllaHome(shell) {
  const h = (await schede(shell)).tabs.find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
}

const suona = (app, titolo, audible) => app.evaluate(({ BrowserWindow }, [t, a]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.tabs.find((x) => x.title === t).view.webContents.emit('audio-state-changed', { audible: a });
}, [titolo, audible]);

const inCorsa = (app, titolo) => app.evaluate(({ BrowserWindow }, t) => !!BrowserWindow.getAllWindows()
  .find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.title === t)?._mediaInCorso, titolo);

const paginaA = (app, url) => app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;
const inPausa = async (app, url) => {
  const p = paginaA(app, url);
  if (!p) return null;
  try { return await p.evaluate(() => window.__statoAudio().pausa); } catch (_) { return null; }
};

test('r1 la musica chiusa mentre suona vince sul video fermato dopo, anche se sulla sua pagina un secondo lettore si è fermato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await openTab(testServer.html(lettore('Musica', true)));
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);
  await suona(app, 'Musica', true);
  // Sulla stessa pagina un secondo lettore parte e si ferma (un'anteprima, un jingle): la musica continua.
  await musica.evaluate(() => document.getElementById('b').play());
  await chat.waitForTimeout(800);
  await musica.evaluate(() => document.getElementById('b').pause());
  await chat.waitForTimeout(800);

  const video = await openTab(testServer.html(lettore('Video')));
  await video.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Video')).toBe(true);
  await suona(app, 'Video', true);
  await video.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Video', false);
  await expect.poll(() => video.evaluate(() => window.__statoAudio().pausa)).toBe(true);

  await chat.waitForTimeout(1500);
  expect(await musica.evaluate(() => window.__statoAudio().pausa), 'la musica suona ancora quando si chiude').toBe(false);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), (await schede(shell)).tabs.find((t) => t.url === url).id);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'g8a', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');

  await expect.poll(async () => (await schede(shell)).tabs.filter((t) => t.url === url).length, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => inPausa(app, url), { timeout: 15_000 }).toBe(false);
  expect(await video.evaluate(() => window.__statoAudio().pausa), 'il video resta fermo').toBe(true);
  await ripristina(app);
});

test('r2 nella scheda della musica si è passati a un\'altra pagina: «rimettimi la musica» rimette la musica', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await openTab(testServer.html(lettore('Musica')));
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);
  await suona(app, 'Musica', true);
  await musica.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Musica', false);
  await expect.poll(() => inPausa(app, url)).toBe(true);

  // Nella stessa scheda l'utente segue un collegamento verso un articolo.
  const articolo = testServer.html('<!doctype html><title>Articolo</title><p>un articolo da leggere');
  await musica.evaluate((u) => { location.href = u; }, articolo);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === articolo)).toBe(true);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'g8b', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');

  await expect.poll(() => inPausa(app, url), { timeout: 20_000 }).toBe(false);
  await expect(chat.locator('.dash-activity').last()).not.toContainText('non è ripartita', { timeout: 1000 });
  await ripristina(app);
});
