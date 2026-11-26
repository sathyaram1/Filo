// Verifica #553.16 giro 1: «chiudi le schede» che non chiude niente (c'è solo questa, nessuna di quel sito), salvata
// come Filo la salva adesso e riaperta, deve dire la stessa riga del diario in diretta, col perché.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r1 chiudi le schede senza niente da chiudere, riaperta, si legge come in diretta', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await newtabPage(app);
  const id = 'chat-chiudi-schede-vuota';
  // Le uscite vere del gestore delle schede quando non c'è niente da chiudere: non eseguita, zero chiuse.
  const azioni = [
    { type: 'CHIUDI_SCHEDE', _executed: false, _output: { chiuse: 0, nessuna: 'niente' } },
    { type: 'CHIUDI_SCHEDE', sito: 'youtube.com', _executed: false, _output: { chiuse: 0, nessuna: 'sito' } },
  ];
  const dirette = await app.evaluate(async (_e, { chatId, azioni }) => {
    const voci = azioni.map((a) => globalThis.SN_ESITO.voceArchivio(a));
    const dirette = azioni.map((a) => globalThis.SN_RIGHE_ATTIVITA.riga(a));
    await globalThis.SN_FILO_CHATS.append(chatId, { role: 'user', text: 'chiudi le schede' });
    await globalThis.SN_FILO_CHATS.append(chatId, { role: 'filo', text: 'Non c\'era niente da chiudere.', esiti: voci });
    return dirette.map((d) => [d.icon, d.text]);
  }, { chatId: id, azioni });
  expect(dirette[0]).toEqual(['⚠', 'Nessuna scheda chiusa · c\'è solo questa']);
  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${id}`);
  const bolla = riaperta.locator('.dash-bubble-filo', { hasText: 'Non c\'era niente da chiudere' });
  await expect(bolla).toBeVisible({ timeout: 10_000 });
  const righe = bolla.locator('.dash-activity-row');
  await expect(righe).toHaveCount(2);
  const viste = await righe.evaluateAll((rs) => rs.map((r) => [r.querySelector('.dash-activity-row-icon')?.textContent || '', r.textContent.replace(/\s+/g, ' ').trim()]));
  await riaperta.screenshot({ path: 'tests/.shots/verifica-553-16-chiudi-schede-riletta.png' });
  for (let i = 0; i < dirette.length; i++) {
    expect(viste[i][0]).toBe(dirette[i][0]);
    expect(viste[i][1]).toContain(dirette[i][1]);
  }
});
