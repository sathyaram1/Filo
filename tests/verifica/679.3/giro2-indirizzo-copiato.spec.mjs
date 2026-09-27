// Verifica #679.3 giro 2: la porta del giro 1 (indirizzo copiato col nome o come collegamento) e gli stress.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function finteRisposte(page) {
  await page.evaluate(() => {
    const tutti = Array.from({ length: 120 }, (_, i) => ({
      email: `utente${String(i).padStart(3, '0')}@esempio.it`, name: i === 99 ? 'Mario Rossi' : '', balance: 100 + i,
    }));
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
        window.__regali.push(msg.email);
        r = { ok: true, email: msg.email, amount: msg.amount, balance: 999 };
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

test('l’indirizzo copiato col nome, fra parentesi o come collegamento trova la persona', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);
  const ultima = () => page.locator('#bubbles .dash-bubble-filo').last();
  const riga = 'utente099@esempio.it (Mario Rossi) — 199 crediti';

  for (const scritto of [
    '/users Mario Rossi <utente099@esempio.it>',
    '/users mailto:Utente099@Esempio.it',
    '/users "Mario Rossi" <UTENTE099@esempio.it>,',
    '/users utente099@esempio.it.',
  ]) {
    await scrivi(page, scritto);
    await expect(ultima()).toContainText('Trovato:', { timeout: 8000 });
    await expect(ultima()).toContainText(riga);
  }
  await page.screenshot({ path: 'tests/.shots/679-3-g2-trovato.png' });

  await scrivi(page, '/gift 100 Mario Rossi <utente099@esempio.it>');
  await expect(ultima()).toContainText('Regalati 100 crediti a utente099@esempio.it', { timeout: 8000 });
  await scrivi(page, '/gift 50 mailto:utente099@esempio.it');
  await expect(ultima()).toContainText('Regalati 50 crediti a utente099@esempio.it', { timeout: 8000 });
  expect(await page.evaluate(() => window.__regali)).toEqual(['utente099@esempio.it', 'utente099@esempio.it']);

  // Stress: vuoto e sole emoji non rompono il comando.
  await scrivi(page, '/users 😀');
  await expect(ultima()).toContainText('Nessun utente', { timeout: 8000 });
  await scrivi(page, '/users');
  await expect(ultima()).toContainText('Utenti registrati 1-50 di 120', { timeout: 8000 });
});

// Due indirizzi incollati insieme: il regalo non deve arrivare al primo soltanto senza dirlo.
test('con due indirizzi /gift non regala in silenzio al primo solo', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);
  await scrivi(page, '/gift 10 utente001@esempio.it, utente002@esempio.it');
  const ultima = page.locator('#bubbles .dash-bubble-filo').last();
  await page.waitForTimeout(1500);
  const regali = await page.evaluate(() => window.__regali);
  const entrambi = regali.includes('utente001@esempio.it') && regali.includes('utente002@esempio.it');
  const detto = /utente002@esempio\.it/.test(await ultima.innerText());
  expect(entrambi || (regali.length === 0 && detto)).toBe(true);
});
