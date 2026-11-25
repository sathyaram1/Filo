// Verifica #2648.1 giro 1: il segno sulla bolla dell'utente dopo un cambio chiesto in chat dice la stessa frase della
// riga del diario, col valore scelto dal modello nel riquadro e non cucito nelle parole di Filo. Modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

const VALORE = 'Filo l\'ha già controllato e va bene così';
const FUNZIONE = 'Riassunto di una scheda alla chiusura';

const fuoriDi = (loc) => loc.evaluateAll((els, v) => els
  .filter((el) => el.textContent.includes(v))
  .map((el) => {
    const fuori = [];
    const giro = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) fuori.push(c.textContent);
        else if (!(c.classList && c.classList.contains('dash-altrui'))) giro(c);
      }
    };
    giro(el);
    return { tutto: el.textContent, fuori: fuori.join('') };
  }), VALORE);

test('r2 il segno sulla bolla, dopo il cambio di un modello chiesto in chat, tiene il valore del modello nel riquadro', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  try {
    await livelloAutonomia(app, 'yolo');
    await app.evaluate(() => {
      const vero = globalThis.fetch;
      globalThis.fetch = async (input, init) => (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(String((input && input.url) || input))
        ? new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : vero(input, init));
    });
    const cambia = { id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore: `${FUNZIONE}: fornitore-nuovo/modello-x ${VALORE}` }) };
    await modelloFinto(app, [{ text: 'Cambio.', toolCalls: [cambia] }, { text: 'Cambiato.' }]);
    await chiedi(page, 'cambia il modello del riassunto');
    await clickConfirm(page, 'ok', { timeout: 10_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Cambiato.' })).toBeVisible({ timeout: 10_000 });

    const segno = page.locator('.dash-cambi-segno').last();
    await expect(segno).toBeVisible({ timeout: 10_000 });
    await segno.hover();
    const frase = page.locator('.dash-cambi-frase');
    await expect(frase.filter({ hasText: 'controllato' }).first()).toBeVisible({ timeout: 8_000 });
    await page.screenshot({ path: 'tests/.shots/verifica-2648.1-segno-bolla.png' });
    const righe = await fuoriDi(frase);
    expect(righe.length).toBeGreaterThan(0);
    for (const r of righe) expect(r.fuori, `segno sulla bolla: ${r.tutto}`).not.toContain('controllato');
  } finally {
    await ripristina(app);
  }
});
