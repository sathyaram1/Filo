// Verifica #1686 giro 2, rilievo 1: la musica che passa al brano dopo (il lettore si ferma e riparte subito, il motore
// la sente sempre) e poi viene chiusa mentre suona deve vincere su un video fermato dopo il cambio di brano.
// Il motore tiene acceso «suona» per un paio di secondi dopo il silenzio: in un cambio rapido non dice «tace».

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const MUSICA = `<!doctype html><title>Musica</title><audio id="a" loop></audio>
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
const suona = (app, titolo, audible) => app.evaluate(({ BrowserWindow }, [t, a]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.tabs.find((x) => x.title === t).view.webContents.emit('audio-state-changed', { audible: a });
}, [titolo, audible]);
const inCorsa = (app, titolo) => app.evaluate(({ BrowserWindow }, t) => !!BrowserWindow.getAllWindows()
  .find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.title === t)?._mediaInCorso, titolo);

test('r1 la musica passata al brano dopo e chiusa mentre suona vince su un video fermato dopo il cambio', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await openTab(testServer.html(MUSICA));
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);
  await suona(app, 'Musica', true);

  // Cambio di brano: il lettore si ferma e riparte in un attimo; il motore non smette di sentirla.
  await chat.waitForTimeout(1000);
  await musica.evaluate(() => document.getElementById('a').pause());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(false);
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);

  // Mentre la musica va, un video con l'audio in un'altra scheda, sentito e fermato.
  await chat.waitForTimeout(1500);
  const video = await openTab(testServer.html(MUSICA.replace('<title>Musica</title>', '<title>Video</title>')));
  await video.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Video')).toBe(true);
  await suona(app, 'Video', true);
  await video.evaluate(() => document.getElementById('a').pause());
  await suona(app, 'Video', false);
  await expect.poll(() => video.evaluate(() => window.__statoAudio().pausa)).toBe(true);

  // La musica si chiude mentre suona ancora.
  await chat.waitForTimeout(1500);
  expect(await musica.evaluate(() => window.__statoAudio().pausa)).toBe(false);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), (await schede(shell)).tabs.find((t) => t.url === url).id);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  const h = (await schede(shell)).tabs.find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'g2r1', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');

  await expect(chat.locator('.dash-activity').last()).toContainText('Riaperta e ripartita', { timeout: 20_000 });
  await expect(chat.locator('.dash-activity').last()).toContainText('Musica');
  expect(await video.evaluate(() => window.__statoAudio().pausa)).toBe(true);
  await ripristina(app);
});
