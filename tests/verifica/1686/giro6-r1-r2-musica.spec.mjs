// Verifica #1686 giro 6: r1 un suono di notifica arrivato dopo la pausa diventa «la musica» da rimettere; r2 la musica
// suonata da un lettore che la pagina non ha messo nel documento (new Audio) non riparte.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const wav = (secondi, attacca) => `<script>
  const n = Math.floor(${secondi} * 8000), buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin(i / 4) * 8000, true);
  const a = new Audio();
  a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  ${attacca ? 'document.body.appendChild(a);' : ''}
  window.__a = a; window.__plays = 0; a.addEventListener('play', () => { window.__plays += 1; });
</script>`;
const pagina = (titolo, secondi, attacca = true) => `<!doctype html><title>${titolo}</title><body>${wav(secondi, attacca)}</body>`;

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [src, a]) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return new Function('tm', 'x', `return (${src})(tm, x)`)(t, a);
}, [fn.toString(), arg]);
// Nel contenitore non c'è un'uscita audio: il «si sente» del motore lo si dà a mano, come nelle altre prove.
const suona = (app, titolo, audible) => tm(app, (t, [ti, a]) => {
  t.tabs.find((x) => x.title === ti).view.webContents.emit('audio-state-changed', { audible: a });
}, [titolo, audible]);
const inCorsa = (app, titolo) => tm(app, (t, ti) => !!t.tabs.find((x) => x.title === ti)?._mediaInCorso, titolo);
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
async function tornaAllaHome(shell) {
  const h = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
}

test('r1 un suono di notifica in un\'altra scheda, arrivato dopo la pausa, non prende il posto della musica', async ({ app, shell, openTab, testServer }) => {
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

  // La posta (o una chat sul web) suona il suo avviso di mezzo secondo.
  await chat.waitForTimeout(1500);
  const posta = await openTab(testServer.html(pagina('Posta', 0.4)));
  await posta.evaluate(() => window.__a.play());
  await expect.poll(() => inCorsa(app, 'Posta')).toBe(true);
  await suona(app, 'Posta', true);
  await expect.poll(() => posta.evaluate(() => window.__a.ended), { timeout: 5000 }).toBe(true);
  await suona(app, 'Posta', false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'n1', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect(chat.locator('.dash-activity').last()).toContainText('ripartire', { timeout: 25_000 });
  await expect.poll(() => musica.evaluate(() => !window.__a.paused), { timeout: 15_000 }).toBe(true);
  expect(await posta.evaluate(() => window.__plays), 'l\'avviso della posta non risuona').toBe(1);
  await ripristina(app);
});

test('r2 la musica di un lettore che la pagina non mette nel documento riparte', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  const radio = await openTab(testServer.html(pagina('Radio', 60, false)));
  await radio.evaluate(() => window.__a.play());
  await expect.poll(() => inCorsa(app, 'Radio')).toBe(true);
  await suona(app, 'Radio', true);
  await chat.waitForTimeout(1000);
  await radio.evaluate(() => window.__a.pause());
  await suona(app, 'Radio', false);
  await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'o1', name: 'RIPRENDI_AUDIO', arguments: '{}' }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(chat, 'rimettimi la musica');
  await expect(chat.locator('.dash-activity').last()).toContainText('ripartire', { timeout: 30_000 });
  await expect.poll(() => radio.evaluate(() => !window.__a.paused), { timeout: 15_000 }).toBe(true);
  await ripristina(app);
});
