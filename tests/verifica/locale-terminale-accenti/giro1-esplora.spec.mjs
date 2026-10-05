// Esplorazione del giro 1: nomi con accenti e trattino lungo creati dal terminale di Filo con cmd.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.skip(process.platform !== 'win32', 'cmd esiste solo su Windows');

const imposta = (page, terminal) => page.evaluate((t) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { terminal: t } }, (r) => resolve(r));
}), terminal);

const invia = (page, v) => page.evaluate((valore) => {
  const input = document.getElementById('input');
  input.value = valore;
  document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}, v);

async function apriCmd(openTab, dir) {
  const page = await openTab('filo://dashboard/dashboard.html');
  await imposta(page, { enabled: true, shell: 'cmd' });
  await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  await invia(page, `/cd /d "${dir}"`);
  await expect(page.locator('#dashDir')).toHaveText(dir, { timeout: 15_000 });
  return page;
}

async function esegui(page, comando, segno) {
  const prima = await page.locator('.dash-term-out').count();
  await invia(page, `/${comando} & echo ${segno}`);
  await expect.poll(() => page.locator('.dash-term-out').count(), { timeout: 15_000 }).toBeGreaterThan(prima);
  const out = page.locator('.dash-term-out').last();
  await expect(out).toContainText(segno, { timeout: 15_000 });
  return out.innerText();
}

const NOMI = [
  'RELAZIONE — attività finale.txt',
  'perché così è più già.txt',
  'naïve façade Ü ß ñ.txt',
  'citazione «virgolette» – breve.txt',
  'euro € e simboli ™ ….txt',
  'emoji 😀 e cinese 中文.txt',
  'percento 50% è pronto.txt',
  'esclamativo ciao! è.txt',
  'e commerciale a & b è.txt',
  'accento all\'inizio è.txt',
];

test('nomi con accenti nascono uguali e compaiono così in dir (echo >)', async ({ openTab }) => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('filo accenti-');
  const esiti = [];
  try {
    const page = await apriCmd(openTab, dir);
    let i = 0;
    for (const nome of NOMI) {
      i += 1;
      const out = await esegui(page, `echo riga ${i} > "${nome}"`, `FATTO${i}`);
      const disco = readdirSync(dir);
      esiti.push({ nome, suDisco: disco.includes(nome), disco, out });
    }
    const dirOut = await esegui(page, 'dir /b', 'ELENCO');
    for (const e of esiti) e.inDir = dirOut.includes(e.nome);
    writeFileSync(join(process.env.VERIFICA_OUT || dir, 'esiti-echo.json'), JSON.stringify({ esiti, dirOut }, null, 2), 'utf8');
    console.log(JSON.stringify({ esiti: esiti.map((e) => ({ nome: e.nome, suDisco: e.suDisco, inDir: e.inDir })), disco: readdirSync(dir), dirOut }, null, 2));
    for (const e of esiti) {
      expect.soft(e.suDisco, `su disco manca «${e.nome}»: ${JSON.stringify(e.disco)}`).toBe(true);
      expect.soft(e.inDir, `in dir manca «${e.nome}»`).toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('altre strade: type nul, copy, mkdir, ren, contenuto, dir lungo', async ({ openTab }) => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('filo accenti2-');
  try {
    const page = await apriCmd(openTab, dir);
    await esegui(page, 'type nul > "RELAZIONE — attività finale.txt"', 'T1');
    await esegui(page, 'mkdir "Cartella — perché"', 'T2');
    await esegui(page, 'copy "RELAZIONE — attività finale.txt" "Cartella — perché\\copia è.txt"', 'T3');
    await esegui(page, 'ren "RELAZIONE — attività finale.txt" "RELAZIONE — attività definitiva.txt"', 'T4');
    await esegui(page, 'echo città è già > "contenuto.txt"', 'T5');
    const lungo = await esegui(page, 'dir', 'T6');
    const sotto = await esegui(page, 'dir /b "Cartella — perché"', 'T7');
    const disco = readdirSync(dir);
    const contenuto = readFileSync(join(dir, 'contenuto.txt'));
    console.log(JSON.stringify({ disco, lungo, sotto, contenutoHex: contenuto.toString('hex'), contenutoUtf8: contenuto.toString('utf8') }, null, 2));
    expect.soft(disco).toContain('RELAZIONE — attività definitiva.txt');
    expect.soft(disco).toContain('Cartella — perché');
    expect.soft(lungo).toContain('RELAZIONE — attività definitiva.txt');
    expect.soft(lungo).toContain('Cartella — perché');
    expect.soft(sotto).toContain('copia è.txt');
    expect.soft(readdirSync(join(dir, 'Cartella — perché'))).toContain('copia è.txt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il file chiesto all\'assistente con cmd nasce col nome chiesto', async ({ openTab }) => {
  test.setTimeout(120_000);
  const dir = cartellaTemporanea('filo accenti3-');
  try {
    const page = await openTab('filo://dashboard/dashboard.html');
    await imposta(page, { enabled: true, shell: 'cmd' });
    const esegui1 = (c) => page.evaluate((comando) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: { type: 'ESEGUI_COMANDO', comando } }, (r) => resolve(r));
    }), c);
    const a = await esegui1(`cd /d "${dir}"`);
    const b = await esegui1('echo x > "RELAZIONE — attività finale.txt"');
    const c = await esegui1('dir /b');
    console.log(JSON.stringify({ a, b, c, disco: readdirSync(dir) }, null, 2).slice(0, 3000));
    expect.soft(readdirSync(dir)).toContain('RELAZIONE — attività finale.txt');
    expect.soft(String(c?.output?.stdout || '')).toContain('RELAZIONE — attività finale.txt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
