// Verifica #2070 giro 1, rilievo 1: un incollato su più righe nel campo della parola d'ordine.
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

// Un incollato su più righe in un campo di una riga arriva con gli a capo cambiati in spazi: il controllo «una riga
// sola» non lo vede, e si salva una parola sbagliata senza avviso.
test('r1 incollate le due righe che «Discutiamone» copia, non si salva in silenzio una parola sbagliata', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(8)] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await apriScheda(page, 'automation');
  await page.locator('#mgParola').focus();
  await page.keyboard.insertText("Parola d'ordine: abc123\nDiscutiamo la domanda D-3");
  await page.locator('#mgParolaSalva').click();
  await expect(page.locator('#mgParolaMsg')).not.toHaveText('');
  const salvata = /Salvata/.test(await page.locator('#mgParolaMsg').textContent());
  if (!salvata) return; // rifiutata col motivo: va bene
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-8').click();
  await dq(page, 'D-8').locator('button', { hasText: 'Discutiamone' }).click();
  await expect.poll(() => appunti(app)).toBe("Parola d'ordine: abc123\nDiscutiamo la domanda D-8");
});
