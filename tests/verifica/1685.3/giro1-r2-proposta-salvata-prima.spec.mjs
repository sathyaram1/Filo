// Verifica #1685.3 giro 1, rilievo 2: una proposta di evento salvata dalle versioni già uscite (che della fine tenevano
// solo la frase «dal 10/12/2026 al 15/12/2026») entra nel calendario con la fine che il bottone mostra passandoci sopra.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { home, ripristina } from '../../helpers/chatFinta.mjs';

const intervalli = async (app) => (await app.evaluate(() => globalThis.__icsAperti || [])).map((f) => {
  const testo = readFileSync(f, 'utf8');
  return ['SUMMARY', 'DTSTART', 'DTEND'].map((k) => (testo.match(new RegExp(`^${k}[^\\r\\n]*`, 'm')) || [''])[0]).join(' ');
});

// I campi che l'archivio teneva fino alla 0.2.295: quelli del modello, mentre l'evento già sistemato chiama la fine
// dataFine/oraFine/durataMin. Della fine resta solo la frase per l'utente.
const SALVATI_PRIMA = [
  { titolo: 'Ferie', data: '2026-12-10', ora: '', quando: 'dal 10/12/2026 al 15/12/2026, tutto il giorno' },
  { titolo: 'Corso', data: '2026-12-02', ora: '10:00', quando: '2/12/2026 alle 10:00, fino alle 13:30' },
];

test('r2 una proposta salvata dalla versione di prima entra nel calendario lunga quanto dice il suo bottone', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(({ shell }) => {
    globalThis.__openPathVero = shell.openPath;
    globalThis.__icsAperti = [];
    shell.openPath = async (f) => { globalThis.__icsAperti.push(f); return ''; };
  });
  try {
    const id = await app.evaluate(async (_e, eventi) => {
      const C = globalThis.SN_FILO_CHATS;
      const ts = (s) => new Date(Date.now() - (60 - s) * 1000).toISOString();
      const chat = await C.append(null, [{ role: 'user', text: 'segnami le ferie e il corso', ts: ts(0) }]);
      await C.append(chat.id, [{
        role: 'filo', text: 'Ecco i due eventi.', ts: ts(1),
        esiti: eventi.map((evento) => ({ type: 'EVENTO_CALENDARIO', esito: 'proposto', riga: `Evento «${evento.titolo}»`, evento })),
      }]);
      return chat.id;
    }, SALVATI_PRIMA);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Aggiungi al calendario' });
    await expect(bottoni, 'riaperta, tornano i due bottoni').toHaveCount(2, { timeout: 8_000 });
    await expect(bottoni.first()).toHaveAttribute('title', /dal 10\/12\/2026 al 15\/12\/2026/);
    for (let n = 2; n > 0; n--) {
      await bottoni.first().click();
      await expect(bottoni).toHaveCount(n - 1, { timeout: 10_000 });
    }
    expect((await intervalli(app)).sort(), 'nel calendario la fine che il bottone prometteva').toEqual([
      'SUMMARY:Corso DTSTART:20261202T100000 DTEND:20261202T133000',
      'SUMMARY:Ferie DTSTART;VALUE=DATE:20261210 DTEND;VALUE=DATE:20261216',
    ]);
  } finally {
    await app.evaluate(({ shell }) => { if (globalThis.__openPathVero) shell.openPath = globalThis.__openPathVero; });
    await ripristina(app);
  }
});
