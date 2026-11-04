// Verifica #1686 giro 6: esplorazione della ripresa della musica.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const wav = (secondi, attacca) => `<script>
  const dur = ${secondi}, rate = 8000, n = Math.floor(dur * rate);
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin(i / 4) * 8000, true);
  const a = new Audio();
  a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  ${attacca ? 'document.body.appendChild(a);' : ''}
  window.__a = a;
  window.__pausa = () => a.paused;
</script>`;
const pagina = (titolo, secondi, attacca = true) => `<!doctype html><title>${titolo}</title><body>${wav(secondi, attacca)}</body>`;

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [src, a]) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return (0, eval)(src)(t, a);
}, [fn.toString(), arg]);
const suona = (app, titolo, audible) => tm(app, (t, [ti, a]) => {
  t.tabs.find((x) => x.title === ti).view.webContents.emit('audio-state-changed', { audible: a });
}, [titolo, audible]);
const inCorsa = (app, titolo) => tm(app, (t, ti) => !!t.tabs.find((x) => x.title === ti)?._mediaInCorso, titolo);
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
async function tornaAllaHome(shell) {
  const h = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
}

test('suono di notifica in un\'altra scheda dopo la pausa della musica', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await openTab(testServer.html(pagina('Musica', 60)));
  await musica.evaluate(() => window.__a.play());
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(true);
  await suona(app, 'Musica', true);
  await chat.waitForTimeout(1500);
  await musica.evaluate(() => window.__a.pause());
  await suona(app, 'Musica', false);
  await expect.poll(() => inCorsa(app, 'Musica')).toBe(false);

  await chat.waitForTimeout(1500);
  const posta = await openTab(testServer.html(pagina('Posta', 0.4)));
  await posta.evaluate(() => window.__a.play());
  await expect.poll(() => inCorsa(app, 'Posta')).toBe(true);
  await suona(app, 'Posta', true);
  await expect.poll(() => posta.evaluate(() => window.__a.ended), { timeout: 5000 }).toBe(true);
  await expect.poll(() => inCorsa(app, 'Posta')).toBe(false);
  await suona(app, 'Posta', false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'n1', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect(chat.locator('.dash-activity').last()).toContainText(/Musica|Posta/, { timeout: 25_000 });
  console.log('ATTIVITA', await chat.locator('.dash-activity').last().innerText());
  await expect.poll(() => musica.evaluate(() => window.__pausa()), { timeout: 15_000 }).toBe(false);
  await ripristina(app);
});

test('musica suonata da un lettore fuori dalla pagina (new Audio) riparte', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const musica = await openTab(testServer.html(pagina('Radio', 60, false)));
  await musica.evaluate(() => window.__a.play());
  await expect.poll(() => inCorsa(app, 'Radio')).toBe(true);
  await suona(app, 'Radio', true);
  await chat.waitForTimeout(1000);
  await musica.evaluate(() => window.__a.pause());
  await suona(app, 'Radio', false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'o1', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect(chat.locator('.dash-activity').last()).toContainText('Radio', { timeout: 30_000 });
  console.log('ATTIVITA', await chat.locator('.dash-activity').last().innerText());
  await expect.poll(() => musica.evaluate(() => window.__pausa()), { timeout: 15_000 }).toBe(false);
  await ripristina(app);
});
