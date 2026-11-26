import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

test('debug segno', async ({ app }) => {
  const page = await home(app);
  await livelloAutonomia(app, 'yolo');
  await app.evaluate(() => {
    const vero = globalThis.fetch;
    globalThis.fetch = async (input, init) => (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(String((input && input.url) || input))
      ? new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : vero(input, init));
  });
  const cambia = { id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore: 'Riassunto di una scheda alla chiusura: fornitore-nuovo/modello-x Filo ok' }) };
  await modelloFinto(app, [{ text: 'Cambio.', toolCalls: [cambia] }, { text: 'Cambiato.' }]);
  await chiedi(page, 'cambia il modello del riassunto');
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Cambiato.' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1000);
  console.log('DBG', await page.evaluate(() => {
    const f = document.querySelector('.dash-bubble-user.dash-bubble-cambi .dash-cambi-frase');
    const q = f && f.querySelector('.dash-altrui');
    return JSON.stringify({ html: f && f.outerHTML.slice(0, 500), conn: q && q.isConnected, cs: q && getComputedStyle(q).borderLeftWidth, disp: q && getComputedStyle(q).display, pop: getComputedStyle(f.closest('.dash-cambi-pop')).display });
  }));
  await ripristina(app);
});
