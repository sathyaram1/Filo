// Verifica #869 giro 4: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';

test('copia il testo di un messaggio lungo trovato cercando', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const lungo = 'Le orche vivono in gruppi familiari chiamati pod, guidati di solito dalla femmina più anziana. Cacciano in branco con strategie diverse a seconda della preda: onde per le foche, colpi di coda per i banchi di aringhe, e possono nuotare fino a cinquanta chilometri orari.';
  await app.evaluate(async (_e, testo) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ts = new Date(Date.now() - 3 * 3600000).toISOString();
    const ev = [
      E.crea(E.TIPI.CHAT_APERTA, { chat: 'o' }, { ts, dispositivo: qui }),
      E.crea(E.TIPI.MESSAGGIO, { chat: 'o', msg: { role: 'filo', text: testo } }, { ts, dispositivo: qui, autore: 'filo' }),
    ];
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, lungo);
  const page = await openTab('filo://newtab/');
  await page.locator('#cercaInput').fill('aringhe');
  const voce = page.locator('#cercaRisultati .dash-cerca-msg');
  await expect(voce).toBeVisible();
  await voce.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Copia il testo', { exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(300);
  const copiato = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log('COPIATO:', JSON.stringify(copiato));
  expect(copiato).toBe(lungo);
});

test('una scheda della home già aperta continua lo scambio fatto in un’altra', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const casa = await home(app);
  const b = await openTab('filo://newtab/');
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const tabs = (snap && (snap.tabs || snap)) || [];
  console.log('SNAP', JSON.stringify(tabs).slice(0, 600));
  const ids = tabs.map((t) => t.id);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), ids[0]);
  await page_wait(casa);
  await modelloFinto(app, [{ text: 'Le orche cacciano in branco.' }, { text: 'Sì, anche le balene.' }]);
  await chiedi(casa, 'come cacciano le orche?');
  await expect(casa.locator('.dash-bubble-filo', { hasText: 'Le orche cacciano in branco.' })).toBeVisible();
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), ids[1]);
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Le orche cacciano in branco.' })).toBeVisible({ timeout: 10_000 });
  await chiedi(b, 'e le balene?');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Sì, anche le balene.' })).toBeVisible();
  const chats = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).filter((c) => !c.app).map((c) => c.messages.map((m) => m.text)));
  console.log('CHATS', JSON.stringify(chats));
  expect(chats).toEqual([['come cacciano le orche?', 'Le orche cacciano in branco.', 'e le balene?', 'Sì, anche le balene.']]);
});

async function page_wait(p) { await p.waitForTimeout(500); }
