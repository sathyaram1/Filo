// #2070 (SPEC-SEDI §4.5): la parola d'ordine «owner non fidato» si salva in Automazioni, cifrata e fuori da
// storage.json; «Discutiamone» e il tasto destro della domanda la copiano sopra la riga, tolta torna la riga sola.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from './helpers/gestioneMainFinto.mjs';

const PAROLA = 'cavallo-blu-7Qx2-ottobre-lampione';
const DUE_RIGHE = `Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-8`;
const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const svuota = (app) => app.evaluate(({ clipboard }) => clipboard.writeText('vuoti'));

async function sezione(page, nome, pannello) {
  await page.locator(`.mg-sezione[data-sezione="${nome}"]`).click();
  await expect(page.locator(pannello)).toHaveClass(/mg-panel--active/);
}

async function scatta(page, locator, nome) {
  await locator.screenshot({ path: `tests/.shots/${nome}.png` });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await locator.screenshot({ path: `tests/.shots/${nome}-scuro.png` });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));
}

test('salvata in Automazioni, «Discutiamone» e il tasto destro copiano la parola sopra la riga; tolta, la riga sola', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(8, { titolo: 'Colore dei pulsanti' })] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const cifra = await app.evaluate(({ safeStorage }) => { try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; } });
  const menu = page.locator('.mg-ctxmenu').last();
  const tasto = dq(page, 'D-8').locator('button[data-fai="discuti"]');

  // Senza parola: la riga sola, e l'hover lo dice.
  await sezione(page, 'domande', '#panel-domande');
  await riga(page, 'D-8').click();
  await expect(tasto).toHaveAttribute('title', 'Copia «Discutiamo la domanda D-8» da incollare in una sessione locale');

  await sezione(page, 'routine', '#panel-automation');
  const blocco = page.locator('#mgParolaBlock');
  const campo = page.locator('#mgParola');
  await expect(blocco).toBeVisible();
  await expect(page.locator('#mgParolaTogli')).toBeHidden();
  await expect(page.locator('#mgParolaStato')).toHaveText('');
  await page.locator('#mgParolaSalva').click();
  await expect(page.locator('#mgParolaMsg')).toHaveText('Incolla la parola d’ordine: il campo è vuoto.');
  // Più righe incollate non diventano una parola sola attaccata: si rifiutano.
  const incolla = async (testo) => {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
    await campo.focus();
    await page.keyboard.press('Control+V');
  };
  await incolla(`Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-1`);
  await expect(page.locator('#mgParolaMsg')).toHaveText('Hai incollato più righe: incolla solo la parola d’ordine.');
  await expect(campo).toHaveValue('');
  // Anche per una strada che non è l'incolla (trascinato, inserito): gli a capo non diventano spazi.
  await campo.focus();
  await page.keyboard.insertText(`Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-1`);
  await expect(page.locator('#mgParolaMsg')).toHaveText('Hai incollato più righe: incolla solo la parola d’ordine.');
  await expect(campo).toHaveValue('');
  // Uno spazio scritto a mano resta: la parola può averne.
  await page.keyboard.type('a b');
  await expect(campo).toHaveValue('a b');
  await campo.fill('');

  // La riga copiata con gli spazi e l'a capo entra pulita, e Invio la salva.
  await incolla(`  ${PAROLA}  \n`);
  await expect(campo).toHaveValue(PAROLA);
  await expect(page.locator('#mgParolaMsg')).toHaveText('');
  await campo.press('Enter');
  await expect(page.locator('#mgParolaMsg')).toHaveText(cifra
    ? 'Salvata: «Discutiamone» la copia insieme alla riga.'
    : 'Salvata solo fino alla chiusura di Filo: questo computer non la sa cifrare, e in chiaro non la scrivo.');
  await expect(page.locator('#mgParolaStato')).toHaveText(cifra ? '· salvata' : '· salvata fino alla chiusura di Filo');
  await expect(campo).toHaveValue('');
  await expect(campo).toHaveAttribute('placeholder', 'Incollane un’altra per cambiarla');
  await expect(page.locator('#mgParolaTogli')).toBeVisible();
  // Mai in chiaro sul disco: cifrata nel suo file, e niente in storage.json.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));
  const bin = join(userData, 'parola-owner.bin');
  if (cifra) {
    expect(existsSync(bin)).toBe(true);
    const blob = readFileSync(bin);
    expect(blob.toString('latin1')).not.toContain(PAROLA);
    expect(await app.evaluate(({ safeStorage }, b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')), blob.toString('base64'))).toBe(PAROLA);
  } else {
    expect(existsSync(bin)).toBe(false);
    test.info().annotations.push({ type: 'note', description: 'safeStorage non disponibile: cifratura a riposo non verificata qui' });
  }
  if (existsSync(join(userData, 'storage.json'))) expect(readFileSync(join(userData, 'storage.json'), 'utf8')).not.toContain(PAROLA);
  await scatta(page, blocco, 'manage-parola-automazioni');

  // «Discutiamone»: due righe negli appunti, l'hover lo dice, a schermo la parola non compare.
  await sezione(page, 'domande', '#panel-domande');
  await riga(page, 'D-8').click();
  await expect(tasto).toHaveAttribute('title',
    'Copia la parola d’ordine «owner non fidato» e «Discutiamo la domanda D-8», da incollare nella sessione dal telefono');
  await svuota(app);
  await tasto.click();
  await expect.poll(() => appunti(app)).toBe(DUE_RIGHE);
  await expect(dq(page, 'D-8').locator('.mg-dq-msg')).toHaveText('Copiato: la parola d’ordine e «Discutiamo la domanda D-8»');
  await expect(page.locator('body')).not.toContainText(PAROLA);
  await scatta(page, dq(page, 'D-8'), 'manage-parola-discutiamone');

  // Il tasto destro della domanda fa lo stesso.
  await svuota(app);
  await riga(page, 'D-8').click({ button: 'right' });
  const voce = menu.locator('.sn-select-option', { hasText: 'Discutiamo la domanda D-8' });
  await expect(voce).toHaveText('Copia parola d’ordine e «Discutiamo la domanda D-8»');
  await expect(voce).toHaveAttribute('title', /parola d’ordine «owner non fidato»/);
  await voce.click();
  await expect.poll(() => appunti(app)).toBe(DUE_RIGHE);

  // Tolta, con la conferma sullo stesso tasto: torna la riga sola, anche nell'hover e nel tasto destro.
  await sezione(page, 'routine', '#panel-automation');
  const togli = page.locator('#mgParolaTogli');
  const prima = await togli.boundingBox();
  await togli.click();
  await expect(togli).toHaveText('Confermi?');
  expect((await togli.boundingBox()).x).toBe(prima.x);
  await togli.click();
  await expect(page.locator('#mgParolaMsg')).toHaveText('Tolta: «Discutiamone» copia solo la riga.');
  await expect(togli).toBeHidden();
  await expect(page.locator('#mgParolaStato')).toHaveText('');
  expect(existsSync(bin)).toBe(false);

  await sezione(page, 'domande', '#panel-domande');
  await riga(page, 'D-8').click();
  await expect(tasto).toHaveAttribute('title', 'Copia «Discutiamo la domanda D-8» da incollare in una sessione locale');
  await svuota(app);
  await tasto.click();
  await expect.poll(() => appunti(app)).toBe('Discutiamo la domanda D-8');
  await expect(dq(page, 'D-8').locator('.mg-dq-msg')).toHaveText('Copiato: «Discutiamo la domanda D-8»');
  await riga(page, 'D-8').click({ button: 'right' });
  await expect(menu.locator('.sn-select-option', { hasText: 'Discutiamo la domanda D-8' })).toHaveText('Copia «Discutiamo la domanda D-8»');
});

test('appunti che non rispondono: «Discutiamone» lo dice e mostra la riga da ricopiare, non un «Copiato» falso', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(8)] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await app.evaluate(({ clipboard }) => {
    globalThis.__scriviVero = clipboard.writeText;
    clipboard.writeText = () => { throw new Error('occupati'); };
  });
  try {
    await sezione(page, 'domande', '#panel-domande');
    await riga(page, 'D-8').click();
    await dq(page, 'D-8').locator('button[data-fai="discuti"]').click();
    await expect(dq(page, 'D-8').locator('.mg-dq-msg')).toHaveText('Non riesco a copiare. La riga è: Discutiamo la domanda D-8');
  } finally {
    await app.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.__scriviVero; });
  }
});

test('un’altra pagina di Filo non la salva, non la toglie e non la mette negli appunti', async ({ app, openTab }) => {
  const gestione = await openTab(MANAGE);
  await gestione.waitForFunction(() => window.filo && window.filo.message);
  expect(await gestione.evaluate(() => window.SN_MANAGE_PAROLA.salvata())).toBe(false);
  expect(await gestione.evaluate((p) => window.filo.message({ type: 'parola_owner_salva', parola: p }), PAROLA)).toMatchObject({ ok: true, salvata: true });
  // Salvata da un'altra parte, la Gestione aperta lo sa dall'annuncio: l'hover di «Discutiamone» non resta vecchio.
  await expect.poll(() => gestione.evaluate(() => window.SN_MANAGE_PAROLA.salvata())).toBe(true);
  await expect(gestione.locator('#mgParolaStato')).toContainText('salvata');

  const altra = await openTab('filo://options/options.html');
  await altra.waitForFunction(() => window.filo && window.filo.message);
  await svuota(app);
  for (const msg of [{ type: 'discutiamone_copia', id: 'D-8' }, { type: 'parola_owner_salva', parola: 'altra-parola-di-un-intruso' },
    { type: 'parola_owner_togli' }, { type: 'parola_owner_stato' }]) {
    expect(await altra.evaluate((m) => window.filo.message(m), msg)).toMatchObject({ ok: false, code: 'forbidden' });
  }
  expect(await appunti(app)).toBe('vuoti');
  // Quella salvata dalla Gestione è rimasta lei.
  await gestione.evaluate(() => window.filo.message({ type: 'discutiamone_copia', id: 'D-8' }));
  await expect.poll(() => appunti(app)).toBe(DUE_RIGHE);
});
