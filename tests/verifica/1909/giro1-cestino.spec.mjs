// Verifica #1909, giro 1: «cancella il file» dalla chat della home sposta nel cestino con un clic; «per sempre» vuole la
// parola; dopo una lettura chiede col riquadro leggero; un comando che cancella senza cestino vuole la parola.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { confirmState, clickConfirm, fillConfirmInput, aspettaConfermaPronta } from '../../helpers/confirm.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const DOPO_UNA_LETTURA = { contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }] };
const nelCestino = (nome) => {
  const d = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'Trash', 'files');
  return existsSync(d) && readdirSync(d).some((n) => n === nome || n.startsWith(nome.replace(/\.[^.]+$/, '')));
};

test('«cancella il file» a Normale: riquadro leggero, un clic, il file finisce nel cestino', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-1909-');
  const nome = `bolletta vecchia ${Date.now()}.pdf`;
  const file = join(dir, nome);
  writeFileSync(file, 'x');
  try {
    await livelloAutonomia(app, 'normale');
    await modelloFinto(app, [
      { toolCalls: [{ id: 'e1', name: 'ELIMINA_FILE', arguments: JSON.stringify({ percorsi: [file] }) }] },
      { text: 'Fatto.' },
    ]);
    const page = await home(app);
    await chiedi(page, `cancella il file ${nome}`);
    await expect.poll(async () => (await confirmState(page))?.text || '', { timeout: 15000 }).toContain('Spostare nel cestino');
    const s = await confirmState(page);
    expect(s.hasInput).toBe(false);
    expect(`${s.title}\n${s.text}`).toContain(nome);
    expect(s.text).toMatch(/ritrovi nel cestino/i);
    await page.screenshot({ path: join(SHOTS, '1909-riquadro-leggero.png') });
    await aspettaConfermaPronta(page);
    await clickConfirm(page, 'ok');
    await expect.poll(() => existsSync(file), { timeout: 15000 }).toBe(false);
    if (process.platform === 'linux') expect(nelCestino(nome)).toBe(true);
    await page.screenshot({ path: join(SHOTS, '1909-dopo.png') });
  } finally { await ripristina(app); }
});

test('«cancella per sempre» dalla chat: riquadro grave con la parola, e il file sparisce senza cestino', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-1909-');
  const nome = `vecchio ${Date.now()}.txt`;
  const file = join(dir, nome);
  writeFileSync(file, 'x');
  try {
    await livelloAutonomia(app, 'normale');
    await modelloFinto(app, [
      { toolCalls: [{ id: 'e1', name: 'ELIMINA_FILE', arguments: JSON.stringify({ percorsi: [file], per_sempre: true }) }] },
      { text: 'Fatto.' },
    ]);
    const page = await home(app);
    await chiedi(page, `cancella per sempre ${nome}`);
    // Il «per sempre» resta a clic esplicito, come ogni azione distruttiva: il bottone apre il riquadro grave.
    await page.locator('.dash-action-btn', { hasText: 'Cancellare per sempre' }).click({ timeout: 15000 });
    await expect.poll(async () => (await confirmState(page))?.hasInput || false, { timeout: 15000 }).toBe(true);
    const s = await confirmState(page);
    expect(s.text).toContain('Cancellare per sempre');
    await page.screenshot({ path: join(SHOTS, '1909-riquadro-grave.png') });
    await aspettaConfermaPronta(page);
    await fillConfirmInput(page, 'conferma');
    await clickConfirm(page, 'danger');
    await expect.poll(() => existsSync(file), { timeout: 15000 }).toBe(false);
    if (process.platform === 'linux') expect(nelCestino(nome)).toBe(false);
  } finally { await ripristina(app); }
});

test('dopo una lettura: cestino chiede un OK senza parola; rm, del, Remove-Item vogliono la parola', async ({ app }) => {
  const dir = cartellaInCasa('filo-1909-');
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'x');
  await livelloAutonomia(app, 'normale');
  const r = await execAction(app, { type: 'ELIMINA_FILE', percorsi: [file] }, DOPO_UNA_LETTURA);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(existsSync(file)).toBe(true);
  for (const comando of [`rm "${file}"`, `Remove-Item -LiteralPath "${file}"`, `del "${file}"`]) {
    const c = await execAction(app, { type: 'ESEGUI_COMANDO', comando }, {});
    expect(c.executed, comando).toBe(false);
    expect(c.needsConfirm, comando).toBe(3);
  }
  expect(existsSync(file)).toBe(true);
});

test('cartella con file dentro, nome con emoji e HTML: il riquadro dice quanti elementi e il nome com\'è', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-1909-');
  const cart = join(dir, `foto <b>vacanze<b> 🌊 ${Date.now()}`);
  mkdirSync(cart);
  for (let i = 0; i < 3; i++) writeFileSync(join(cart, `${i}.jpg`), 'x');
  try {
    await livelloAutonomia(app, 'normale');
    await modelloFinto(app, [
      { toolCalls: [{ id: 'e1', name: 'ELIMINA_FILE', arguments: JSON.stringify({ percorsi: [cart] }) }] },
      { text: 'Fatto.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'elimina la cartella delle foto');
    await expect.poll(async () => (await confirmState(page))?.text || '', { timeout: 15000 }).toContain('questa cartella');
    const s = await confirmState(page);
    expect(s.text).toContain('3 elementi');
    expect(s.text).toContain('<b>vacanze<b> 🌊');
    expect(s.hasInput).toBe(false);
    await aspettaConfermaPronta(page);
    await clickConfirm(page, 'ok');
    await expect.poll(() => existsSync(cart), { timeout: 15000 }).toBe(false);
    await expect(page.locator('.dash-action-btn', { hasText: 'Nel cestino' })).toBeVisible({ timeout: 15000 });
  } finally { await ripristina(app); }
});
