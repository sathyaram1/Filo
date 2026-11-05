// Verifica #1563 giro 3, rilievo 2: chi scrive poco non arriva mai alla soglia né al tratto «grande» da fermo; i suoi
// messaggi escono dai giorni del tratto senza essere compattati, e di loro non resta niente davanti al modello.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

test('r2 una chat di quattro giorni fa, breve, resta davanti al modello almeno come riga del diario', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(async () => {
    const Chats = globalThis.SN_FILO_CHATS;
    const t0 = Date.now() - 4 * 24 * 60 * 60 * 1000;
    await Chats.append('poco1', { role: 'user', text: 'ho prenotato alla Trattoria Zanzibar per sabato alle 21, ricordamelo', ts: new Date(t0).toISOString() });
    await Chats.append('poco1', { role: 'filo', text: 'Va bene, sabato alle 21 alla Zanzibar.', ts: new Date(t0 + 5000).toISOString() });
    const t1 = Date.now() - 20 * 60 * 60 * 1000;
    await Chats.append('poco2', { role: 'user', text: 'che tempo fa domani?', ts: new Date(t1).toISOString() });
    await Chats.append('poco2', { role: 'filo', text: 'Sole.', ts: new Date(t1 + 5000).toISOString() });
  });
  await modelloFinto(app, [{ text: 'Eccomi.' }]);
  const C = await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__vero = C._dip.chiama;
    globalThis.__chieste = 0;
    C._dip.chiama = async ({ messages }) => {
      globalThis.__chieste++;
      const t = messages.map((m) => m.content).join('\n');
      return JSON.stringify({ ore: [{ testo: /Zanzibar/.test(t) ? '20:00 prenotato alla Trattoria Zanzibar per sabato alle 21' : '10:00 chiesto il tempo' }], memorie: [] });
    };
    return true;
  });
  expect(C).toBe(true);
  try {
    await chiedi(page, 'dove avevo prenotato per sabato?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Eccomi.' })).toBeVisible({ timeout: 20000 });
    const [richiesta] = await chiamateAlModello(app);
    expect(JSON.stringify(richiesta), 'la prenotazione di quattro giorni fa è ancora davanti al modello, grezza o nel diario').toContain('Zanzibar');
  } finally {
    await app.evaluate(() => { if (globalThis.__vero) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__vero; });
    await ripristina(app);
  }
});
