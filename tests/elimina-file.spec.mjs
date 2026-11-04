// #1909 — «cancella il file X» sposta il file nel cestino del sistema dopo un clic, anche dopo una lettura e mai col
// riquadro da scrivere; «per sempre» vuole la parola «conferma»; un comando del terminale che cancella senza cestino è un
// «per sempre». Il modello è finto: chiama lo strumento col percorso che gli darebbe l'utente.
import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, fillConfirmInput } from './helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';
import { cartellaInCasa, cartellaTemporanea } from './helpers/percorsi.mjs';
import { writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

// Il cestino che il sistema usa su Linux (freedesktop): lì il file spostato si ritrova col suo nome.
const cestinoLinux = () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'Trash');
function nelCestino(nome) {
  if (process.platform !== 'linux') return null;
  return existsSync(join(cestinoLinux(), 'files', nome));
}
function togliDalCestino(nome) {
  if (process.platform !== 'linux') return;
  rmSync(join(cestinoLinux(), 'files', nome), { force: true, recursive: true });
  rmSync(join(cestinoLinux(), 'info', `${nome}.trashinfo`), { force: true });
}
const elimina = (id, args) => ({ toolCalls: [{ id, name: 'ELIMINA_FILE', arguments: JSON.stringify(args) }] });

test('a Normale «cancella il file in Download» lo sposta nel cestino dopo un clic, e lì si ritrova', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-cestino-');
  const nome = `bolletta luce ${Date.now()}.pdf`;
  const file = join(dir, nome);
  writeFileSync(file, '%PDF-1.4 bolletta');
  const page = await home(app);
  try {
    await modelloFinto(app, [elimina('e1', { percorsi: [file] }), { text: 'Fatto.' }]);
    await chiedi(page, `cancella il file ${nome} in Download`);
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
    const s = await confirmState(page);
    expect(s.hasInput, 'il cestino si conferma con un clic, non con la parola').toBe(false);
    expect(s.text).toContain('Spostare nel cestino questo file:');
    expect(s.text).toContain(nome);
    expect(s.text).toContain(dir);
    expect(s.text).toContain('Lo ritrovi nel cestino, se vuoi rimetterlo al suo posto.');
    expect(s.text).toContain('Te lo chiedo sempre, prima di toccare i tuoi file.');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'elimina-file-cestino.png') });
    expect(existsSync(file), 'prima del clic il file è ancora al suo posto').toBe(true);

    await clickConfirm(page, 'ok');
    await expect.poll(() => existsSync(file), { timeout: 15_000 }).toBe(false);
    if (process.platform === 'linux') expect(nelCestino(nome), 'il file si ritrova nel cestino').toBe(true);
    await expect(page.locator('.dash-action-btn').filter({ hasText: `Nel cestino «${nome}»` })).toBeVisible({ timeout: 10_000 });
  } finally {
    await ripristina(app);
    togliDalCestino(nome);
  }
});

test('dopo aver letto una pagina, «cancella X» chiede col riquadro leggero, mai con quello da scrivere', async ({ app, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<!doctype html><title>blog</title><p>Una pagina qualunque.</p>');
  const dir = cartellaInCasa('filo-cestino-letto-');
  const nome = `appunti ${Date.now()}.txt`;
  const file = join(dir, nome);
  writeFileSync(file, 'appunti');
  const page = await home(app);
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._dip.scarica = (u, o) => fetch(u, o); });
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'p1', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ url }) }] },
      { text: 'Letta.' },
      elimina('e1', { percorsi: [file] }),
      { text: 'Fine.' },
    ]);
    await chiedi(page, `leggi ${url}`);
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Letta.' })).toBeVisible({ timeout: 15_000 });
    await chiedi(page, `cancella ${nome}`);
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
    const s = await confirmState(page);
    expect(s.hasInput, 'dopo una lettura il cestino chiede, ma non vuole la parola').toBe(false);
    expect(s.text).toContain('Spostare nel cestino questo file:');
    expect(s.text).toContain(nome);
    expect(s.text).toContain('Te lo chiedo sempre, prima di toccare i tuoi file.');
    expect(s.text).not.toContain('proposta');
    await clickConfirm(page, 'cancel');
    expect(existsSync(file), 'annullato, il file resta').toBe(true);
  } finally {
    await ripristina(app);
  }
});

test('«cancellalo per sempre» vuole la parola «conferma», e il file non finisce nel cestino', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-per-sempre-');
  const nome = `vecchio ${Date.now()}.txt`;
  const file = join(dir, nome);
  writeFileSync(file, 'da buttare');
  const page = await home(app);
  try {
    await modelloFinto(app, [elimina('e1', { percorsi: [file], per_sempre: true }), { text: 'Fatto.' }]);
    await chiedi(page, `cancella per sempre ${nome}`);
    // Una cosa che non si disfa non apre il riquadro da sola: lo apre il clic sul bottone.
    const bottone = page.locator('.dash-action-btn-primary').last();
    await expect(bottone).toBeVisible({ timeout: 20_000 });
    await bottone.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    const s = await confirmState(page);
    expect(s.hasInput, 'per sempre vuole la parola').toBe(true);
    expect(s.text).toContain('Cancellare per sempre questo file:');
    expect(s.text).toContain(nome);
    expect(s.text).toContain('Non passa dal cestino: non si potrà più recuperare.');
    expect(existsSync(file)).toBe(true);
    await fillConfirmInput(page, 'conferma');
    const premuto = await page.evaluate(() => window.SN_CONFIRM_UI._test.click('danger') || window.SN_CONFIRM_UI._test.click('ok'));
    expect(premuto).toBe(true);
    await expect.poll(() => existsSync(file), { timeout: 15_000 }).toBe(false);
    if (process.platform === 'linux') expect(nelCestino(nome), 'per sempre non passa dal cestino').toBe(false);
  } finally {
    await ripristina(app);
    togliDalCestino(nome);
  }
});

test('una cartella dice quanti elementi contiene; fuori dalla cartella personale, o la cartella personale intera, non si tocca', async ({ app }) => {
  const dir = cartellaInCasa('filo-cestino-cartella-');
  const sotto = join(dir, 'foto vecchie');
  mkdirSync(join(sotto, 'mare'), { recursive: true });
  writeFileSync(join(sotto, 'a.jpg'), 'a');
  writeFileSync(join(sotto, 'mare', 'b.jpg'), 'b');
  const r = await execAction(app, { type: 'ELIMINA_FILE', percorsi: [sotto] });
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toContain('Spostare nel cestino questa cartella, con 3 elementi dentro:\n«foto vecchie»');
  expect(r.describe).toContain('La ritrovi nel cestino, se vuoi rimetterla al suo posto.');
  expect(existsSync(sotto), 'senza il clic non si sposta niente').toBe(true);

  const fuori = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts';
  const no = await execAction(app, { type: 'ELIMINA_FILE', percorsi: [fuori, '~'] });
  expect(no.executed).toBe(false);
  expect(no.needsConfirm).toBeFalsy();
  expect(no.output.saltati.map((x) => x.perche)).toEqual(['sta fuori dalla tua cartella personale', 'è la tua cartella personale, o la contiene']);
  expect(existsSync(fuori)).toBe(true);

  const vuoto = await execAction(app, { type: 'ELIMINA_FILE', percorsi: [join(dir, 'non esiste.txt')] });
  expect(vuoto.executed).toBe(false);
  expect(vuoto.output.saltati[0].perche).toBe('non c\'è');
});

test('un comando del terminale che cancella senza cestino vuole la parola «conferma» anche a compito pulito', async ({ app }) => {
  const dir = cartellaInCasa('filo-rm-');
  const file = join(dir, 'prova.txt');
  writeFileSync(file, 'x');
  const comando = process.platform === 'win32' ? `Remove-Item -LiteralPath "${file}"` : `rm "${file}"`;
  const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando, spiegazione: 'Cancello il file' });
  expect(r.needsConfirm, 'il riquadro grave, con la parola').toBe(3);
  expect(r.describe).toContain('Perché te lo chiedo: cancella per sempre, senza passare dal cestino');
  expect(existsSync(file)).toBe(true);
});

// All'OK si sposta solo quello che il riquadro ha mostrato, e ogni percorso si ricontrolla: un elenco cambiato dopo la
// domanda non porta via un file fuori dalla cartella personale, nascosto o mai mostrato.
test('all\'OK vale l\'elenco mostrato, ricontrollato: un percorso fuori, nascosto o cambiato dopo la domanda resta dov\'è', async ({ app }) => {
  const dir = cartellaInCasa('filo-cestino-ok-');
  const mostrato = join(dir, `mostrato ${Date.now()}.txt`);
  const maiMostrato = join(dir, 'mai mostrato.txt');
  const nascosto = join(dir, '.nascosto');
  const fuoriDir = cartellaTemporanea('filo-cestino-fuori-');
  const fuori = join(fuoriDir, 'fuori.txt');
  for (const f of [mostrato, maiMostrato, nascosto, fuori]) writeFileSync(f, 'x');
  const page = await home(app);
  try {
    const r = await execAction(app, { type: 'ELIMINA_FILE', percorsi: [mostrato] });
    expect(r.needsConfirm).toBe(2);
    // La conferma arriva con l'elenco mostrato a cui sono stati aggiunti altri file, e coi percorsi cambiati.
    const forgiato = {
      type: 'ELIMINA_FILE', percorsi: [maiMostrato],
      _file: [{ percorso: mostrato, nome: 'mostrato.txt', tipo: 'file' }, { percorso: fuori, nome: 'fuori.txt', tipo: 'file' },
        { percorso: nascosto, nome: '.nascosto', tipo: 'file' }, { percorso: 'relativo.txt', nome: 'relativo.txt', tipo: 'file' }],
    };
    const c = await page.evaluate((a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), forgiato);
    expect(existsSync(mostrato), 'il file mostrato va nel cestino').toBe(false);
    expect(existsSync(fuori), 'fuori dalla cartella personale non si tocca').toBe(true);
    expect(existsSync(nascosto), 'un file nascosto non si tocca').toBe(true);
    expect(existsSync(maiMostrato), 'i percorsi cambiati dopo la domanda non contano').toBe(true);
    expect(c.output.eliminati).toEqual([basename(mostrato)]);
    const perche = c.output.falliti.map((x) => x.perche);
    expect(perche).toHaveLength(2);
    expect(perche).toEqual(expect.arrayContaining(['è un file nascosto o di un programma', 'sta fuori dalla tua cartella personale']));
  } finally {
    togliDalCestino(basename(mostrato));
    rmSync(fuoriDir, { recursive: true, force: true });
  }
});

// Riuscito, al giro dopo il modello sa che il file è nel cestino (non cancellato per sempre). Il file sparito fra la
// domanda e il clic: il bottone lo dice.
test('dopo il clic il modello sa che il file è nel cestino; un file sparito prima del clic dice «Non cancellato»', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-cestino-esito-');
  const nome = `riuscito ${Date.now()}.txt`;
  const file = join(dir, nome);
  writeFileSync(file, 'x');
  const page = await home(app);
  try {
    await modelloFinto(app, [elimina('e1', { percorsi: [file] }), { text: 'Va bene.' }]);
    await chiedi(page, `cancella ${nome}`);
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-action-btn').filter({ hasText: `Nel cestino «${nome}»` })).toBeVisible({ timeout: 10_000 });
    await chiedi(page, 'grazie');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 15_000 }).toBeGreaterThan(1);
    const ultimo = JSON.stringify((await chiamateAlModello(app)).at(-1));
    expect(ultimo).toContain('Spostato nel cestino un elemento (si rimette da lì)');
    expect(ultimo).not.toContain('Cancellato per sempre');
  } finally {
    await ripristina(app);
    togliDalCestino(nome);
  }

  const sparisce = join(dir, `sparisce ${Date.now()}.txt`);
  writeFileSync(sparisce, 'x');
  try {
    await modelloFinto(app, [elimina('e2', { percorsi: [sparisce] }), { text: 'Va bene.' }]);
    await chiedi(page, `cancella ${basename(sparisce)}`);
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
    rmSync(sparisce);
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-action-btn').filter({ hasText: /Non cancellato: non c.è più/ })).toBeVisible({ timeout: 10_000 });
  } finally {
    await ripristina(app);
  }
});
