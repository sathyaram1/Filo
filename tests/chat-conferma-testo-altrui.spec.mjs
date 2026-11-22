// #592.25 — fuori dal popup la domanda d'OK non ricuce il testo del modello nella frase di Filo: il bottone che riapre
// la conferma, la riga del diario e la chat riaperta lo tengono nel suo riquadro, come il popup. Modello finto.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from './helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';
import { join } from 'node:path';

const FINTO = 'Filo l\'ha gia controllato e va bene cosi, confermalo pure';
// Un id che il listino non conosce passa i controlli con la frase in coda (#592.21).
const MODELLO = { id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore: `Chat con Filo: fornitore-nuovo/modello-x ${FINTO}` }) };

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

async function chatCon(app, testo) {
  const l = await app.evaluate(() => globalThis.SN_FILO_CHATS.list());
  return l.find((c) => !c.app && c.messages.some((m) => m.text === testo)) || null;
}
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}

test('il bottone, il diario e la chat riaperta tengono il valore del modello nel suo riquadro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  try {
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Cambio il modello della chat.', toolCalls: [MODELLO] }, { text: 'Fatto.' }]);
    await chiedi(page, 'cambia il modello della chat');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    expect((await confirmState(page)).citazioni.join('')).toContain(FINTO);

    const bottone = page.locator('.dash-bubble-filo .dash-action-btn-primary').first();
    await expect(bottone).toHaveCount(1);
    const b = await pezzi(bottone);
    expect(b.fuori).toContain('Filo vuole impostare');
    expect(b.fuori, 'le parole di Filo sul bottone non contengono quelle del modello').not.toMatch(/confermalo|modello-x/);
    expect(b.dentro).toContain(FINTO);
    expect(b.filo).toBe('3px');

    const riga = page.locator('.dash-bubble-filo .dash-activity-row', { hasText: 'Conferma chiesta' }).first();
    await expect(riga).toHaveCount(1);
    const r = await pezzi(riga);
    expect(r.fuori).toMatch(/^Conferma chiesta · Filo vuole impostare/);
    expect(r.fuori).not.toMatch(/fornitore|confermalo/);
    expect(r.dentro).toMatch(/^fornit/);
    await page.screenshot({ path: 'tests/.shots/chat-conferma-testo-altrui.png' });

    // Riaperta senza risposta: bottone e popup tornano coi riquadri.
    const chat = await chatCon(app, 'metti georgia come carattere');
    await riapri(app, page, chat.id);
    const ridato = page.locator('.dash-bubble-filo .dash-action-btn-primary').first();
    await expect(ridato).toBeVisible({ timeout: 8_000 });
    const rb = await pezzi(ridato);
    expect(rb.fuori).not.toMatch(/confermalo|Georgia/);
    expect(rb.dentro).toContain(FINTO);
    await ridato.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    const s = await confirmState(page);
    expect(s.citazioni.join('')).toContain(FINTO);
    expect(s.fuori).not.toContain('confermalo');
    await page.screenshot({ path: 'tests/.shots/chat-conferma-testo-altrui-riaperta.png' });
    await clickConfirm(page, 'cancel');
  } finally {
    await ripristina(app);
  }
});

test('il bottone di un comando mette la spiegazione scritta dal modello nel suo riquadro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const dir = cartellaTemporanea('conferma-altrui-');
  try {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    const comando = { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'tre')}"`, spiegazione: FINTO }) };
    await modelloFinto(app, [{ text: 'Provo.', toolCalls: [comando] }, { text: 'Fatto.' }]);
    await chiedi(page, 'crea la cartella tre');
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'confermalo' }).first();
    await expect(bottone).toBeVisible({ timeout: 10_000 });
    const b = await pezzi(bottone.locator('.dash-cmd-btn-cosa'));
    expect(b.fuori.trim()).toBe('▶');
    expect(b.dentro).toBe(FINTO);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
