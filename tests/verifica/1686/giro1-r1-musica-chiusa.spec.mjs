// Verifica #1686, rilievo 1: la musica ascoltata fino alla chiusura della sua scheda perde contro un video sentito
// dopo che lei era già partita. «Rimettimi la musica» deve riaprire quella chiusa, non far ripartire l'altro.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const lettore = (titolo) => `<!doctype html><title>${titolo}</title><audio id="a" loop></audio>
<script>
  const n = 30 * 8000, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  const a = document.getElementById('a');
  a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  window.__pausa = () => a.paused;
</script>`;

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [f, x]) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return new Function('tm', 'x', `return (${f})(tm, x)`)(t, x);
}, [fn.toString(), arg]);

const suona = (app, titolo, audible) => tm(app, (t, [ti, a]) => {
  t.tabs.find((x) => x.title === ti).view.webContents.emit('audio-state-changed', { audible: a });
}, [titolo, audible]);
const inCorsa = (app, titolo) => tm(app, (t, ti) => !!t.tabs.find((x) => x.title === ti)?._mediaInCorso, titolo);
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);

test('r1 la musica chiusa mentre suonava vince sul video fermato dopo che lei era partita', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await openTab(testServer.html(lettore('Musica lunga')));
  const urlMusica = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica lunga')).toBe(true);
  await suona(app, 'Musica lunga', true);

  // Mentre la musica va, un video con l'audio in un'altra scheda, sentito e fermato.
  await chat.waitForTimeout(1500);
  const video = await openTab(testServer.html(lettore('Video notizie')));
  await video.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Video notizie')).toBe(true);
  await suona(app, 'Video notizie', true);
  await video.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Video notizie', false);
  await expect.poll(() => video.evaluate(() => window.__pausa())).toBe(true);

  // La scheda della musica si chiude mentre suona ancora.
  await chat.waitForTimeout(1500);
  const idMusica = (await schede(shell)).find((t) => t.url === urlMusica).id;
  await shell.evaluate((x) => window.filoShell.tabs.close(x), idMusica);
  await expect.poll(async () => (await schede(shell)).some((t) => t.url === urlMusica)).toBe(false);
  const h = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'm1', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');

  await expect(chat.locator('.dash-activity').last()).toContainText('Musica lunga', { timeout: 20_000 });
  expect((await schede(shell)).filter((t) => t.url === urlMusica).length).toBe(1);
  expect(await video.evaluate(() => window.__pausa())).toBe(true);
  await ripristina(app);
});
