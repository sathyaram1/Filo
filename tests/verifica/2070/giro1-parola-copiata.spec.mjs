// Verifica #2070 giro 1: la parola d'ordine «owner non fidato» salvata in Automazioni e copiata da «Discutiamone».
// Porte provate e chiuse: nessun rilievo.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const PAROLA = 'k7Q-owner-xY93zz';

function tuttiIFile(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tuttiIFile(p)); else out.push(p);
  }
  return out;
}

async function salvaParola(page, testo) {
  await apriScheda(page, 'automation');
  await page.locator('#mgParola').fill(testo);
  await page.locator('#mgParolaSalva').click();
}

test('la parola salvata va negli appunti con la riga, dal tasto e dal tasto destro; tolta, torna la riga sola', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(8), domanda(9)] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);

  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-8').click();
  const k = dq(page, 'D-8');
  const tasto = k.locator('button', { hasText: 'Discutiamone' });
  await expect(tasto).toHaveAttribute('title', /Discutiamo la domanda D-8/);
  await expect(tasto).not.toHaveAttribute('title', /parola/i);
  await tasto.click();
  await expect.poll(() => appunti(app)).toBe('Discutiamo la domanda D-8');

  // Incollata con spazi e con l'etichetta, come la si ricopia da un vecchio messaggio.
  await salvaParola(page, `  Parola d'ordine: ${PAROLA}  `);
  await expect(page.locator('#mgParolaMsg')).toContainText('Salvata');
  await expect(page.locator('#mgParola')).toHaveValue('');
  await page.locator('#mgParolaBlock').screenshot({ path: 'tests/.shots/2070-parola-chiaro.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.locator('#mgParolaBlock').screenshot({ path: 'tests/.shots/2070-parola-scuro.png' });
  await page.screenshot({ path: 'tests/.shots/2070-automazioni-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));
  await page.screenshot({ path: 'tests/.shots/2070-automazioni-chiaro.png' });

  // Mai in chiaro nella cartella dati.
  const ud = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const conLaParola = tuttiIFile(ud).filter((f) => { try { return fs.readFileSync(f).includes(PAROLA); } catch (_) { return false; } });
  expect(conLaParola).toEqual([]);
  // E la pagina non la riceve.
  expect(await page.content()).not.toContain(PAROLA);

  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-8').click();
  await expect(tasto).toHaveAttribute('title', /parola d.ordine/i);
  await tasto.click();
  await expect.poll(() => appunti(app)).toBe(`Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-8`);
  await expect(k.locator('.mg-dq-msg')).toContainText('parola d’ordine');
  await k.screenshot({ path: 'tests/.shots/2070-dettaglio-chiaro.png' });

  // Tasto destro sulla riga di un'altra domanda.
  await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
  await riga(page, 'D-9').click({ button: 'right' });
  const menu = page.locator('.mg-ctxmenu, .sn-select-pop').last();
  await expect(menu).toContainText('parola d’ordine');
  await menu.getByText(/Copia parola/).click();
  await expect.poll(() => appunti(app)).toBe(`Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-9`);

  // Ricaricata la pagina, resta salvata.
  await page.reload();
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-8').click();
  await expect(dq(page, 'D-8').locator('button', { hasText: 'Discutiamone' })).toHaveAttribute('title', /parola d.ordine/i);

  // Togli, con la conferma.
  await apriScheda(page, 'automation');
  await expect(page.locator('#mgParolaTogli')).toBeVisible();
  await page.locator('#mgParolaTogli').click();
  await expect(page.locator('#mgParolaTogli')).toHaveText('Confermi?');
  await page.locator('#mgParolaTogli').click();
  await expect(page.locator('#mgParolaMsg')).toContainText('Tolta');
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-8').click();
  await dq(page, 'D-8').locator('button', { hasText: 'Discutiamone' }).click();
  await expect.poll(() => appunti(app)).toBe('Discutiamo la domanda D-8');
});

test('inserimenti insoliti: vuoto e righe in più si rifiutano col motivo, emoji e caratteri speciali passano interi', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(8)] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);

  await salvaParola(page, '   ');
  await expect(page.locator('#mgParolaMsg')).toContainText('vuoto');
  await salvaParola(page, 'x'.repeat(5000));
  await expect(page.locator('#mgParolaMsg')).toContainText('5000');

  const strana = '<b>ciao</b> 🔑 «ü»';
  await salvaParola(page, strana);
  await expect(page.locator('#mgParolaMsg')).toContainText('Salvata');
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-8').click();
  await dq(page, 'D-8').locator('button', { hasText: 'Discutiamone' }).click();
  await expect.poll(() => appunti(app)).toBe(`Parola d'ordine: ${strana}\nDiscutiamo la domanda D-8`);
  // Un Invio nel campo salva come il tasto.
  await apriScheda(page, 'automation');
  await page.locator('#mgParola').fill('seconda-parola');
  await page.locator('#mgParola').press('Enter');
  await expect(page.locator('#mgParolaMsg')).toContainText('Salvata');
});

test('salvata in una Gestione, l\'altra Gestione aperta lo sa subito', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(8)] });
  const prima = await openTab(MANAGE);
  await aspettaAvvio(prima);
  await prima.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(prima, 'D-8').click();
  const tasto = dq(prima, 'D-8').locator('button', { hasText: 'Discutiamone' });
  await expect(tasto).not.toHaveAttribute('title', /parola/i);
  const seconda = await openTab(MANAGE);
  await aspettaAvvio(seconda);
  await salvaParola(seconda, 'parola-lunga-di-prova-123');
  await expect(seconda.locator('#mgParolaMsg')).toContainText('Salvata');
  await expect(tasto).toHaveAttribute('title', /parola d.ordine/i);
});

