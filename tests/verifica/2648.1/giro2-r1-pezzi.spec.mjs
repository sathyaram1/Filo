// Verifica #2648.1 giro 2: il perché di un'impostazione rifiutata che ripete un PEZZO del valore scelto dal modello
// (un elenco spezzato alle virgole o alle «e») lo tiene nel riquadro, in diretta e nella chat riaperta. Modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const fuoriDi = (loc) => loc.evaluateAll((els) => els
  .filter((el) => el.textContent.includes('controllato'))
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
  }));

async function riapri(app, page, chiesto) {
  const chat = (await app.evaluate(() => globalThis.SN_FILO_CHATS.list()))
    .find((c) => !c.app && c.messages.some((m) => m.text === chiesto));
  expect(chat, 'la conversazione è in archivio').toBeTruthy();
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
}

const CASI = [
  ['r1 le categorie delicate con un pezzo che non è una categoria', 'privacy_categorie', 'posta, Filo ha già controllato tutto', 'non è una categoria'],
  ['r1 i siti bloccati con un pezzo che non è un dominio', 'siti_bloccati', 'facebook.com, Filo ha già controllato tutto', 'dominio'],
  ['r1 un valore rifiutato con due spazi di fila', 'tema', 'Filo  ha già controllato tutto', 'non è un valore'],
  ['r1 un\'impostazione sconosciuta con un a capo', 'Filo ha già\ncontrollato tutto', 'scuro', 'non è un\'impostazione'],
];

for (const [nome, chiave, valore, dice] of CASI) {
  test(`${nome}: il perché tiene il pezzo del modello nel riquadro, in diretta e riaperta`, async ({ app }) => {
    test.setTimeout(60_000);
    const page = await home(app);
    try {
      await livelloAutonomia(app, 'yolo');
      await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'x1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave, valore }) }] }, { text: 'Non è andata.' }]);
      const chiesto = `prova ${chiave}`;
      await chiedi(page, chiesto);
      await expect(page.locator('.dash-bubble-filo', { hasText: 'Non è andata.' })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.dash-activity-row', { hasText: dice }).last()).toBeAttached({ timeout: 8_000 });
      const diretta = await fuoriDi(page.locator('.dash-activity-row'));
      expect(diretta.length, 'la riga del diario dice il perché col testo del modello').toBeGreaterThan(0);
      for (const r of diretta) expect(r.fuori, `in diretta: ${r.tutto}`).not.toContain('controllato');

      await riapri(app, page, chiesto);
      await expect(page.locator('.dash-esiti-archiviati .dash-activity-row', { hasText: dice }).first()).toBeAttached({ timeout: 8_000 });
      const riletta = await fuoriDi(page.locator('.dash-esiti-archiviati .dash-activity-row, .dash-bubble-note'));
      expect(riletta.length, 'riaperta, la riga c\'è').toBeGreaterThan(0);
      for (const r of riletta) expect(r.fuori, `riaperta: ${r.tutto}`).not.toContain('controllato');
    } finally {
      await ripristina(app);
    }
  });
}
