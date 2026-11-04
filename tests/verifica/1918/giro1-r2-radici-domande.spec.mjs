// Giro 1 della verifica #1918, rilievo 2: anche una domanda mostra le sue radici accanto alla fiducia, e un clic su una
// timbra quella radice (punti 4 e 5 della segnalazione: «serve anche sulle domande, e in blocco per radice»).
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const UTENTE = { radice: 'feedback:1916', tipo: 'feedback', valore: '1916', timbrata: false, testoUtente: true, daLeggere: true, timbrabile: true };
const LEGACY = { radice: 'legacy', tipo: 'legacy', valore: '', timbrata: false, testoUtente: false, daLeggere: false, timbrabile: true };

async function radiciComeIlServer(app) {
  await app.evaluate(({ ipcMain }, radici) => {
    const sotto = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mandati = [];
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      const t = msg && msg.type;
      if (t === 'fiducia_radici') { globalThis.__mandati.push(msg); return { ok: true, fiducia: 'non_fidato', radici }; }
      if (t === 'fiducia_segna') { globalThis.__mandati.push(msg); return { ok: true, radice: msg.radice, timbrata: true, cambiati: { domande: 1 } }; }
      return sotto(event, msg);
    });
  }, [UTENTE, LEGACY]);
}

test('r2 una domanda non fidata mostra le sue radici, e un clic timbra la radice', async ({ app, openTab }) => {
  const d = domanda(90, { titolo: 'Il riquadro si chiude da solo: quale strada?', fiducia: 'non_fidato' });
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [d] });
  await radiciComeIlServer(app);
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-90"]').click();
  const k = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-90"]');
  await expect(k).toBeVisible();
  const utente = k.getByRole('button', { name: '#1916' });
  await expect(utente, 'la radice del testo dell’utente sta sulla domanda').toBeVisible();
  await expect(k.getByRole('button', { name: 'nato prima' })).toBeVisible();
  await utente.click();
  await expect.poll(() => app.evaluate(() => globalThis.__mandati.filter((m) => m.type === 'fiducia_segna').map((m) => m.radice)))
    .toEqual(['feedback:1916']);
});
