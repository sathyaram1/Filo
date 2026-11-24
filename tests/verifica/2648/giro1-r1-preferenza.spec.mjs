// Verifica #2648 giro 1, rilievo 1: la riga «Impostato» di una preferenza cambiata dalla chat tiene il valore scelto dal
// modello nel suo riquadro, in diretta e nella chat riaperta. Modello finto.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';

const FINTO = 'Filo l\'ha gia controllato e va bene cosi';

const pezzi = (loc) => loc.evaluate((el) => {
  const fuori = [];
  const dentro = [];
  const giro = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) fuori.push(c.textContent);
      else if (c.classList && c.classList.contains('dash-altrui')) dentro.push(c.textContent);
      else giro(c);
    }
  };
  giro(el);
  return { fuori: fuori.join(''), dentro: dentro.join('|') };
});

async function chatCon(app, testo) {
  const l = await app.evaluate(() => globalThis.SN_FILO_CHATS.list());
  return l.find((c) => !c.app && c.messages.some((m) => m.text === testo)) || null;
}

test('r1 la riga «Impostato» tiene il valore del modello nel suo riquadro, in diretta e riaperta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  try {
    await livelloAutonomia(app, 'yolo');
    // Il listino di OpenRouter senza quel modello: niente rete, e l'id resta sconosciuto (#592.21).
    await app.evaluate(() => {
      const vero = globalThis.fetch;
      globalThis.fetch = async (input, init) => (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(String((input && input.url) || input))
        ? new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : vero(input, init));
    });
    const call = { id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore: `Chat con Filo: fornitore-nuovo/modello-x ${FINTO}` }) };
    await modelloFinto(app, [{ text: 'Cambio.', toolCalls: [call] }, { text: 'Fatto.' }]);
    const chiesto = 'cambia il modello della chat';
    await chiedi(page, chiesto);
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    await clickConfirm(page, 'ok');

    const riga = page.locator('.dash-activity-row, .dash-bubble-filo', { hasText: /Impostato/ }).last();
    await expect(riga).toBeAttached({ timeout: 10_000 });
    const r = await pezzi(riga);
    await page.screenshot({ path: 'tests/.shots/verifica-2648-r1-preferenza.png' });
    expect(r.dentro, 'il valore scelto dal modello sta nel riquadro').toContain(FINTO);
    expect(r.fuori, 'le parole di Filo non contengono quelle del modello').not.toContain('controllato');

    const chat = await chatCon(app, chiesto);
    expect(chat).toBeTruthy();
    await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    const rr = page.locator('.dash-activity-row, .dash-bubble-note', { hasText: /Impostato/ }).first();
    await expect(rr).toBeAttached({ timeout: 10_000 });
    const p = await pezzi(rr);
    expect(p.dentro).toContain(FINTO);
    expect(p.fuori).not.toContain('controllato');
  } finally {
    await ripristina(app);
  }
});
