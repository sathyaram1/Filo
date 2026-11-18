// #2372 giro 3, rilievo 2: con la ricerca aperta, un clic al centro (per guardare il risultato) e poi altre lettere:
// finiscono nella chat, mentre la colonna mostra ancora la ricerca che l'utente sta affinando.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

test('r2 a ricerca aperta, dopo un clic al centro le lettere vanno ancora nella ricerca', async ({ app }) => {
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const iso = (m) => new Date(Date.now() - m * 60_000).toISOString();
    const ev = [E.crea(E.TIPI.CHAT_APERTA, { chat: 'o' }, { ts: iso(30), dispositivo: qui }),
      E.crea(E.TIPI.MESSAGGIO, { chat: 'o', msg: { role: 'user', text: 'come cacciano le orche?' } }, { ts: iso(29), dispositivo: qui, autore: 'utente' }),
      E.crea(E.TIPI.CHAT_CHIUSA, { chat: 'o' }, { ts: iso(28), dispositivo: qui })];
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  });
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#altro .dash-altro-app[data-tasto="1"][data-id="cerca"]').click();
  await page.keyboard.type('orc');
  await expect(page.locator('#cercaRisultati .dash-cerca-msg').first()).toBeVisible();
  const b = await page.locator('#bubbles').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + 30);
  await expect(page.locator('#cercaFilo')).toBeVisible();
  await page.keyboard.type('he');
  await expect(page.locator('#cercaInput')).toHaveValue('orche');
  await expect(page.locator('#input')).toHaveValue('');
});
