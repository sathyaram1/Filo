// Verifica #1686 giro 2, rilievo 2: la musica chiusa e già riaperta (Ctrl/Cmd+Shift+T) che non è ripartita da sola
// deve ripartire lì, non tornare una seconda volta dall'elenco delle chiuse in una scheda doppia.

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

test('r2 la musica chiusa e già riaperta riparte lì, senza una seconda scheda uguale', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await openTab(testServer.html(MUSICA));
  const url = musica.url();
  await musica.evaluate(() => document.getElementById('a').play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);
  await suona(app, 'Musica', true);
  await chat.waitForTimeout(1000);

  // Chiusa per sbaglio mentre suona, e riaperta subito con Ctrl/Cmd+Shift+T: la pagina non riparte da sola.
  await shell.evaluate((x) => window.filoShell.tabs.close(x), (await schede(shell)).tabs.find((t) => t.url === url).id);
  await expect.poll(async () => (await schede(shell)).tabs.some((t) => t.url === url)).toBe(false);
  await chat.waitForTimeout(1500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riapriChiusa());
  await expect.poll(async () => (await schede(shell)).tabs.filter((t) => t.url === url).length, { timeout: 10_000 }).toBe(1);
  const h = (await schede(shell)).tabs.find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
  const prima = (await schede(shell)).tabs.length;

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'g2r2', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Che musica vuoi?' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await chat.waitForTimeout(6000);

  expect((await schede(shell)).tabs.filter((t) => t.url === url).length, 'una sola scheda della musica').toBe(1);
  expect((await schede(shell)).tabs.length).toBe(prima);
  await ripristina(app);
});
