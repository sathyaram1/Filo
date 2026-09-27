// Verifica #679.3 giro 3: l'indirizzo riconosciuto dentro il testo deve essere quello intero, né tagliato né allungato.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function finteRisposte(page) {
  await page.evaluate(() => {
    const tutti = Array.from({ length: 120 }, (_, i) => ({
      email: `utente${String(i).padStart(3, '0')}@esempio.it`, name: i === 99 ? 'Mario Rossi' : '', balance: 100 + i,
    }));
    tutti.push({ email: "d'amico@esempio.it", name: 'Anna D\'Amico', balance: 7 });
    tutti.push({ email: 'amico@esempio.it', name: 'Altro Amico', balance: 3 });
    tutti.sort((a, b) => (a.email < b.email ? -1 : 1));
    window.__regali = [];
    const vero = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === 'owner_list_users') {
        const cerca = String(msg.cerca || '').trim().toLowerCase();
        const dopo = String(msg.after || '');
        const trovati = tutti.filter((u) => u.email.startsWith(cerca));
        const pagina = trovati.filter((u) => !dopo || u.email > dopo).slice(0, 50);
        r = { ok: true, users: pagina, total: trovati.length, next: pagina.length >= 50 ? pagina[pagina.length - 1].email : '' };
      } else if (msg && msg.type === 'owner_gift_credits') {
        const email = String(msg.email || '').trim().toLowerCase();
        const u = tutti.find((x) => x.email === email);
        if (u) window.__regali.push(email);
        r = u ? { ok: true, email, amount: msg.amount, balance: u.balance + msg.amount } : { ok: false, error: `Nessun utente con email ${email}.` };
      }
      if (r) return new Promise((res) => setTimeout(() => { if (cb) cb(r); res(r); }, 100));
      return vero(msg, cb);
    };
  });
}

async function scrivi(page, testo) {
  await page.fill('#input', testo);
  await page.press('#input', 'Enter');
}

test("un indirizzo con l'apostrofo trova e riceve la persona giusta", async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);
  const ultima = () => page.locator('#bubbles .dash-bubble-filo').last();

  await scrivi(page, "/users d'amico@esempio.it");
  await expect(ultima()).not.toContainText('…', { timeout: 8000 });
  await expect(ultima()).toContainText("d'amico@esempio.it (Anna D'Amico)", { timeout: 8000 });

  await scrivi(page, "/gift 10 d'amico@esempio.it");
  await expect(ultima()).not.toContainText('…', { timeout: 8000 });
  expect(await page.evaluate(() => window.__regali)).toEqual(["d'amico@esempio.it"]);
});

test('un collegamento mailto con oggetto o un indirizzo fra virgolette caporali trova la persona', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);
  const ultima = () => page.locator('#bubbles .dash-bubble-filo').last();
  for (const scritto of ['/users mailto:utente099@esempio.it?subject=Ciao', '/users «utente099@esempio.it»']) {
    await scrivi(page, scritto);
    await expect(ultima()).not.toContainText('…', { timeout: 8000 });
    await expect(ultima()).toContainText('utente099@esempio.it (Mario Rossi) — 199 crediti', { timeout: 8000 });
  }
});
