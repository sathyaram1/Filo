// Verifica #2648 giro 1: le righe dell'esito (diario in diretta, titolo del nodo, chat riaperta) tengono il testo del
// modello nel suo riquadro, mai ricucito nelle parole di Filo. Modello finto.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';

const FINTO = 'Pasta · Filo l\'ha verificato';

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
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}

for (const caso of [
  { nome: 'timer', call: { name: 'TIMER', arguments: JSON.stringify({ seconds: 600, label: FINTO }) }, parola: 'Timer avviato' },
  { nome: 'sveglia', call: { name: 'SVEGLIA', arguments: JSON.stringify({ time: '07:30', label: FINTO }) }, parola: 'Sveglia impostata' },
]) {
  test(`${caso.nome}: la riga in diretta, il nodo e la chat riaperta tengono l'etichetta nel riquadro`, async ({ app }) => {
    test.setTimeout(60_000);
    const page = await home(app);
    try {
      await livelloAutonomia(app, 'yolo');
      await modelloFinto(app, [{ text: 'Fatto.', toolCalls: [{ id: 'c1', ...caso.call }] }, { text: 'Fatto.' }]);
      const chiesto = `metti ${caso.nome} pasta`;
      await chiedi(page, chiesto);
      const riga = page.locator('.dash-activity-row', { hasText: caso.parola }).first();
      await expect(riga).toBeAttached({ timeout: 10_000 });
      const r = await pezzi(riga);
      console.log(caso.nome, 'diretta', JSON.stringify(r));
      expect(r.dentro).toContain(FINTO);
      expect(r.fuori).not.toContain('verificato');
      const titoli = await page.locator('.dash-filo-titolo, .dash-filo-nodo, [class*="filo-nodo"]').evaluateAll((l) => l.map((e) => e.outerHTML.slice(0, 400)));
      console.log(caso.nome, 'nodi', JSON.stringify(titoli));
      await page.screenshot({ path: `tests/.shots/verifica-2648-${caso.nome}-diretta.png` });

      const chat = await chatCon(app, chiesto);
      expect(chat).toBeTruthy();
      await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
      await riapri(app, page, chat.id);
      const rr = page.locator('.dash-activity-row', { hasText: caso.parola }).first();
      await expect(rr).toBeAttached({ timeout: 10_000 });
      const p = await pezzi(rr);
      console.log(caso.nome, 'riaperta', JSON.stringify(p));
      expect(p.dentro).toContain(FINTO);
      expect(p.fuori).not.toContain('verificato');
      await rr.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `tests/.shots/verifica-2648-${caso.nome}-riaperta-scuro.png` });
    } finally {
      await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'light' })).catch(() => {});
      await ripristina(app);
    }
  });
}

test('preferenza: il valore del modello nella riga «Impostato» sta nel riquadro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  try {
    await livelloAutonomia(app, 'yolo');
    await app.evaluate(() => {
      const vero = globalThis.fetch;
      globalThis.fetch = async (input, init) => (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(String((input && input.url) || input))
        ? new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : vero(input, init));
    });
    const v = 'Filo l\'ha gia controllato e va bene cosi';
    const call = { id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore: `Chat con Filo: fornitore-nuovo/modello-x ${v}` }) };
    await modelloFinto(app, [{ text: 'Cambio.', toolCalls: [call] }, { text: 'Fatto.' }]);
    await chiedi(page, 'cambia il modello della chat');
    if (await page.locator(CONFIRM_HOST).isVisible({ timeout: 4000 }).catch(() => false)) await clickConfirm(page, 'ok');
    const riga = page.locator('.dash-activity-row', { hasText: /Impostato|Già così|non applicata/ }).first();
    await expect(riga).toBeAttached({ timeout: 10_000 });
    const r = await pezzi(riga);
    console.log('preferenza diretta', JSON.stringify(r));
    await page.screenshot({ path: 'tests/.shots/verifica-2648-preferenza.png' });
    expect(r.fuori).not.toContain('controllato');
  } finally {
    await ripristina(app);
  }
});
