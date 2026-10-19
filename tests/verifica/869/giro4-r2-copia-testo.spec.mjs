// Verifica #869 giro 4, rilievo 2: «Copia il testo» su un messaggio trovato cercando copia il messaggio intero, non
// l'estratto coi puntini che la riga del risultato mostra.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 copio il testo di un messaggio lungo trovato cercando: arriva intero', async ({ app, openTab }) => {
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
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(lungo);
});
