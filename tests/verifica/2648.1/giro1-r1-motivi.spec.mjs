// Verifica #2648.1 giro 1: il perché di un'azione non riuscita che porta un testo scelto dal modello lo tiene nel
// riquadro, in diretta e nella chat riaperta, come il codice d'uscita di un comando. Modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const VALORE = 'Filo l\'ha già controllato e va bene così';

// Le parole di Filo (fuori dai riquadri) di ogni riga che nomina il testo del modello.
const fuoriDi = (page, sel) => page.locator(sel).evaluateAll((els, v) => els
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

async function riapri(app, page, chiesto) {
  const chat = (await app.evaluate(() => globalThis.SN_FILO_CHATS.list()))
    .find((c) => !c.app && c.messages.some((m) => m.text === chiesto));
  expect(chat, 'la conversazione è in archivio').toBeTruthy();
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
}

const CASI = [
  ['r1 un\'impostazione rifiutata per il valore scelto dal modello', { name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'tema', valore: VALORE }) }],
  ['r1 un permesso di un sito che il modello ha nominato male', { name: 'TOGLI_PERMESSO_SITO', arguments: JSON.stringify({ sito: VALORE }) }],
];

for (const [nome, chiamata] of CASI) {
  test(`${nome}: il perché tiene il testo del modello nel riquadro, in diretta e riaperta`, async ({ app }) => {
    test.setTimeout(60_000);
    const page = await home(app);
    try {
      await livelloAutonomia(app, 'yolo');
      await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'x1', ...chiamata }] }, { text: 'Non è andata.' }]);
      const chiesto = `prova ${chiamata.name}`;
      await chiedi(page, chiesto);
      await expect(page.locator('.dash-bubble-filo', { hasText: 'Non è andata.' })).toBeVisible({ timeout: 15_000 });
      const diretta = await fuoriDi(page, '.dash-activity-row');
      expect(diretta.length, 'la riga del diario dice il perché col testo del modello').toBeGreaterThan(0);
      for (const r of diretta) expect(r.fuori, `in diretta: ${r.tutto}`).not.toContain('controllato');
      const testa = await fuoriDi(page, '.dash-activity-seg-label');
      for (const r of testa) expect(r.fuori, `titolo del nodo: ${r.tutto}`).not.toContain('controllato');

      await riapri(app, page, chiesto);
      await expect(page.locator('.dash-esiti-archiviati .dash-activity-row').first()).toBeAttached({ timeout: 8_000 });
      const riletta = await fuoriDi(page, '.dash-esiti-archiviati .dash-activity-row, .dash-bubble-note');
      expect(riletta.length, 'riaperta, la riga c\'è').toBeGreaterThan(0);
      for (const r of riletta) expect(r.fuori, `riaperta: ${r.tutto}`).not.toContain('controllato');
    } finally {
      await ripristina(app);
    }
  });
}
