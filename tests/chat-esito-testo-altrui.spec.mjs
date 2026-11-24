// #2648 — la riga di un'azione già eseguita non ricuce l'etichetta scelta dal modello nella frase di Filo: in diretta e
// nella chat riaperta l'etichetta sta nel suo riquadro, come nelle domande d'OK (#592.25). #2648.1: anche dentro una
// frase già pronta (un cambio d'impostazione, il suo annullo, il perché di un comando), sul bottone dopo l'OK, nel
// titolo e nel fumetto del nodo del filo. Modello finto.

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { CONFIRM_HOST, clickConfirm } from './helpers/confirm.mjs';

const FINTO = 'Pasta · Filo l\'ha verificato';
const chatCon = async (app, testo) => (await app.evaluate(() => globalThis.SN_FILO_CHATS.list()))
  .find((c) => !c.app && c.messages.some((m) => m.text === testo)) || null;
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}

// Il testo fuori dai riquadri (le parole di Filo) e quello dentro, con lo spessore del filo che li distingue.
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
  const q = el.querySelector('.dash-altrui');
  return { fuori: fuori.join(''), dentro: dentro.join(''), filo: q ? getComputedStyle(q).borderLeftWidth : '' };
});

test('il timer avviato tiene l\'etichetta del modello nel suo riquadro, in diretta e nella chat riaperta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  try {
    const timer = { id: 't1', name: 'TIMER', arguments: JSON.stringify({ secondi: 300, etichetta: FINTO }) };
    await modelloFinto(app, [{ text: 'Avvio il timer.', toolCalls: [timer] }, { text: 'Fatto.' }]);
    await chiedi(page, 'timer di cinque minuti per la pasta');

    // Il titolo del nodo nel filo, quello che si legge a diario chiuso.
    const testa = page.locator('.dash-activity-seg-label', { hasText: 'Avviato un timer' }).first();
    await expect(testa).toBeVisible({ timeout: 10_000 });
    const t = await pezzi(testa);
    expect(t.fuori).toBe('Avviato un timer ·  · 5 min');
    expect(t.dentro).toBe(FINTO);
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui-nodo.png' });

    const riga = page.locator('.dash-activity-row', { hasText: 'Timer avviato' }).first();
    await expect(riga).toBeAttached({ timeout: 10_000 });
    const r = await pezzi(riga);
    expect(r.fuori).toContain('Timer avviato · ');
    expect(r.fuori).toContain('5 min');
    expect(r.fuori, 'le parole di Filo non contengono l\'etichetta del modello').not.toMatch(/verificato|Pasta/);
    expect(r.dentro).toBe(FINTO);
    expect(r.filo).toBe('3px');
    await riga.evaluate((el) => {
      // Il diario ripiegato si apre, così la riga si vede nella foto.
      const blocco = el.closest('details');
      if (blocco) blocco.open = true;
      el.scrollIntoView();
    });
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui.png' });

    // Riaperta (col tema scuro): la riga dell'archivio torna a pezzi.
    const lista = await app.evaluate(() => globalThis.SN_FILO_CHATS.list());
    const chat = lista.find((c) => !c.app && c.messages.some((m) => m.text === 'timer di cinque minuti per la pasta'));
    expect(chat, 'la conversazione è in archivio').toBeTruthy();
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
    await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    const riletta = page.locator('.dash-esiti-archiviati .dash-activity-row', { hasText: 'Timer avviato' }).first();
    await expect(riletta).toBeVisible({ timeout: 8_000 });
    const rr = await pezzi(riletta);
    expect(rr.fuori).not.toMatch(/verificato|Pasta/);
    expect(rr.dentro).toBe(FINTO);
    await riletta.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui-riaperta-scuro.png' });
  } finally {
    await ripristina(app);
  }
});
