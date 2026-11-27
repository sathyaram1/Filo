// #1344.2 — senza invito o coi crediti finiti, «Dai un nome sensato» (pagina Download, file della home, avviso del
// nome automatico) e «Ascolta» delle Preferenze dicono perché con la frase di sempre e portano il tasto per Crediti.
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');

function pdfConTesto(righe) {
  const corpo = righe.map((r, i) => `${i ? '0 -24 Td\n' : ''}(${r}) Tj`).join('\n');
  const stream = `BT\n/F1 14 Tf\n40 700 Td\n${corpo}\nET\n`;
  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const posizioni = [];
  oggetti.forEach((o, i) => { posizioni.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`
    + posizioni.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const BOLLETTA = pdfConTesto(['Bolletta luce Enel', 'Marzo 2026']);

// Nessuna chiave e nessun invito: la richiesta non parte.
async function senzaChiave(app) {
  await app.evaluate(async () => {
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    D.get = () => ({ ...orig(), apiKeys: {} });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } });
  });
}

// Una chiave c'è, ma il servizio risponde 402: i crediti sono finiti. La chat della home resta finta.
async function creditiFiniti(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILE_NAME]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => {
      throw Object.assign(new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}'), { status: 402, provider: 'openrouter' });
    };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, complete: boom, synthesizeSpeech: boom };
  });
}

const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs : []))
  .map((t) => t.view.webContents.getURL()));
async function siApre(app, inizio) {
  await expect.poll(async () => (await schede(app)).some((u) => u.startsWith(inizio)), { timeout: 15_000, message: `nessuna scheda ${inizio}` }).toBe(true);
}

async function scarica(nome, { shell, openTab, testServer }) {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': BOLLETTA.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(BOLLETTA);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  // Un nome da internet: da 127.0.0.1, rete di casa, il nome automatico non parte (#1274.1).
  const url = `http://sito-pubblico.test:${srv.address().port}/${nome}`;
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body>`, { pubblico: true });
  await page.locator('#dl').click();
  await expect.poll(async () => ((((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [])
    .find((it) => it.url === url) || {}).state, { timeout: 20000 }).toBe('completed');
  return async () => { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); };
}

// Senza invito la voce non c'è (nessun modello raggiungibile): la frase senza tasto restava coi crediti finiti.
test('pagina Download, coi crediti finiti: «Dai un nome sensato» dice perché e «Apri Crediti» porta lì', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chiudi = await scarica('scan_00412.pdf', { shell, openTab, testServer });
  try {
    await creditiFiniti(app);
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'scan_00412.pdf' }) });
    await riga.click({ button: 'right' });
    await menuDi(dl).scegli('Dai un nome sensato');
    const stato = dl.locator('.sn-rinomina .sn-rinomina-stato');
    await expect(stato).toContainText('crediti', { timeout: 15000 });
    const tasto = stato.locator('.sn-rinomina-rimedio');
    await expect(tasto).toHaveText('Apri Crediti');
    await dl.locator('.sn-rinomina').screenshot({ path: join(SHOTS, '1344-2-nome-download.png') });
    await tasto.click();
    await siApre(app, 'filo://credits');
  } finally { await chiudi(); }
});

test('file trovato in chat nella home, coi crediti finiti: «Dai un nome sensato» porta il tasto per Crediti', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-nomi-crediti-');
  const file = join(dir, 'scan_00512.pdf');
  writeFileSync(file, BOLLETTA);
  try {
    await creditiFiniti(app);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file, etichetta: 'scan_00512.pdf' }) }] },
      { text: 'Eccolo.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'trova la scansione della bolletta');
    const chip = page.locator('.dash-file-btn');
    await expect(chip.locator('.dash-file-btn-nome')).toHaveText('scan_00512.pdf', { timeout: 15000 });
    await chip.click({ button: 'right' });
    await menuDi(page).scegli('Dai un nome sensato');
    const stato = page.locator('.sn-rinomina .sn-rinomina-stato');
    await expect(stato).toContainText('crediti', { timeout: 15000 });
    await expect(stato.locator('.sn-rinomina-rimedio')).toHaveText('Apri Crediti');
    await page.locator('.sn-rinomina').screenshot({ path: join(SHOTS, '1344-2-nome-home.png') });
    await stato.locator('.sn-rinomina-rimedio').click();
    await siApre(app, 'filo://credits');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const caso of ['senza invito', 'crediti finiti']) {
  test(`nome automatico ${caso}: l’avviso «Nessun nome dato» porta «Apri Crediti»`, async ({ app, shell, openTab, testServer, avvisi }) => {
    test.setTimeout(120_000);
    if (caso === 'senza invito') await senzaChiave(app); else await creditiFiniti(app);
    const pref = await openTab('filo://preferences/preferences.html');
    await pref.locator('#nomiSensatiScaricamenti').check();
    await expect.poll(() => app.evaluate(async () => !!(await globalThis.SN_STORAGE.getSettings()).nomiSensati?.scaricamenti)).toBe(true);
    const chiudi = await scarica('scan_00612.pdf', { shell, openTab, testServer });
    try {
      const vista = await avvisi();
      const carta = vista.locator('.shell-notif', { hasText: 'Nessun nome dato' }).last();
      await expect(carta).toBeVisible({ timeout: 20000 });
      await expect(carta).toContainText(caso === 'senza invito' ? 'invito' : 'crediti');
      const tasto = carta.locator('.shell-notif-action', { hasText: 'Apri Crediti' });
      await expect(tasto).toBeVisible();
      await carta.screenshot({ path: join(SHOTS, `1344-2-nome-automatico-${caso.replace(' ', '-')}.png`) });
      await tasto.click();
      await siApre(app, 'filo://credits');
    } finally { await chiudi(); }
  });
}

for (const caso of ['senza invito', 'crediti finiti']) {
  test(`Preferenze, «Ascolta» ${caso}: la frase leggibile e «Apri Crediti» che porta lì`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    if (caso === 'senza invito') await senzaChiave(app); else await creditiFiniti(app);
    const pref = await openTab('filo://preferences/preferences.html');
    await pref.locator('#ttsModelPreview').click();
    const stato = pref.locator('#ttsModelPreviewStatus');
    await expect(stato).toContainText(caso === 'senza invito' ? 'invito' : 'crediti', { timeout: 15000 });
    await expect(stato).not.toContainText(/OpenRouter 402|Insufficient|NO_API_KEY/);
    const tasto = pref.locator('#ttsModelPreviewRimedio');
    await expect(tasto).toHaveText('Apri Crediti');
    await pref.locator('#sec-lettura').screenshot({ path: join(SHOTS, `1344-2-ascolta-${caso.replace(' ', '-')}.png`) });
    await tasto.click();
    await siApre(app, 'filo://credits');
  });
}
