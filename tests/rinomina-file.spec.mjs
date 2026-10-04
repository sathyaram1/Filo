// #950 — «Dai un nome sensato»: dal tasto destro su un file Filo legge il contenuto e propone un nome con le
// sue parole; confermato, il file sul disco ha il nome nuovo; «Annulla» lo riporta indietro. Le stesse cose
// dagli scaricamenti, dalla chat (elenco vecchio → nuovo con conferma), da un file trascinato e da sole sugli
// scaricamenti quando l'utente le accende. Il modello è finto: risponde con le prime righe del documento che riceve.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, cartellaInCasa } from './helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { confirmText, clickConfirm } from './helpers/confirm.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');

function pdfConTesto(righe) {
  const corpo = righe.map((r, i) => `${i ? '0 -24 Td\n' : ''}(${r.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n');
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

const BOLLETTA = pdfConTesto(['Bolletta luce Enel', 'Marzo 2026', 'Totale da pagare 54,20 euro']);
const NOME_NUOVO = 'Bolletta luce Enel Marzo 2026.pdf';

// Il modello dei nomi risponde con le prime due righe del contenuto che gli arriva (e lo ricorda): se il
// testo del PDF non gli arrivasse, il nome non avrebbe le parole del documento.
async function modelloDeiNomi(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__nomiVisti = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const u = messages.find((m) => m.role === 'user');
      const testo = typeof u.content === 'string' ? u.content : u.content.map((p) => p.text || '').join('\n');
      globalThis.__nomiVisti.push(testo);
      const m = /Nome attuale:[^\n]*\n\n([^\n]+)\n([^\n]+)/.exec(testo);
      return { text: m ? `«${m[1]} ${m[2]}.pdf»` : 'NESSUN NOME', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

async function scarica(nome, corpo, { shell, openTab, testServer }) {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': corpo.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(corpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/${nome}`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body></html>`);
  await page.locator('#dl').click();
  let rec = null;
  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    rec = ((r && r.items) || []).find((it) => it.url === url) || null;
    return rec ? rec.state : null;
  }, { timeout: 20000 }).toBe('completed');
  return { rec, chiudi: async () => { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

test('tasto destro su un file trovato in chat → «Dai un nome sensato»: nome con le parole del contenuto, rinomina, Annulla', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-nomi-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, BOLLETTA);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vecchio, etichetta: 'scan_00231.pdf' }) }] },
      { text: 'Eccolo.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'trova la scansione della bolletta');
    const chip = page.locator('a.dash-action-btn');
    await expect(chip).toHaveText('scan_00231.pdf', { timeout: 15000 });

    await chip.click({ button: 'right' });
    const voce = page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' });
    await expect(voce).toBeVisible();
    await voce.click();

    const riquadro = page.locator('.sn-rinomina');
    const campo = riquadro.locator('.sn-rinomina-campo');
    await expect(campo).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
    await expect(riquadro.locator('.sn-rinomina-ext')).toHaveText('.pdf');
    await expect(campo).toBeFocused();
    const visti = await app.evaluate(() => globalThis.__nomiVisti);
    expect(visti.join('\n')).toContain('Totale da pagare');
    await page.screenshot({ path: join(SHOTS, 'rinomina-proposta.png') });

    await riquadro.locator('.sn-rinomina-ok').click();
    await expect(riquadro.locator('.sn-rinomina-esito-testo')).toHaveText(`Rinominato: ${NOME_NUOVO}`);
    expect(existsSync(join(dir, NOME_NUOVO))).toBe(true);
    expect(existsSync(vecchio)).toBe(false);
    // Il riferimento in chat segue il file: un clic dopo apre quello vero.
    await expect(chip).toHaveText(NOME_NUOVO);
    await expect(chip).toHaveAttribute('href', join(dir, NOME_NUOVO));
    await page.screenshot({ path: join(SHOTS, 'rinomina-fatto.png') });

    await riquadro.locator('.sn-rinomina-annulla').click();
    await expect(riquadro.locator('.sn-rinomina-esito-testo')).toHaveText('Nome di prima rimesso: scan_00231.pdf');
    expect(existsSync(vecchio)).toBe(true);
    expect(existsSync(join(dir, NOME_NUOVO))).toBe(false);
    await expect(chip).toHaveText('scan_00231.pdf');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il nome si può correggere prima di confermare, non sovrascrive e non cambia estensione', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-nomi-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, BOLLETTA);
  writeFileSync(join(dir, 'Bolletta marzo.pdf'), 'già qui');
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vecchio, etichetta: 'La scansione' }) }] },
      { text: 'Eccolo.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'trova la scansione');
    const chip = page.locator('a.dash-action-btn', { hasText: 'La scansione' });
    await expect(chip).toBeVisible({ timeout: 15000 });
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    const campo = page.locator('.sn-rinomina-campo');
    await expect(campo).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });

    // Un nome con l'estensione sbagliata e già preso: resta .pdf e prende un numero, il file che c'era resta.
    await campo.fill('Bolletta marzo.txt');
    await campo.press('Enter');
    await expect(page.locator('.sn-rinomina-esito-testo')).toHaveText('Rinominato: Bolletta marzo (2).pdf');
    await expect(page.locator('.sn-rinomina-stato')).toContainText('già preso');
    expect(readdirSync(dir).sort()).toEqual(['Bolletta marzo (2).pdf', 'Bolletta marzo.pdf']);
    // Un'etichetta scelta dal modello resta, ma il riferimento punta al file nuovo.
    await expect(chip).toHaveText('La scansione');
    await expect(chip).toHaveAttribute('href', join(dir, 'Bolletta marzo (2).pdf'));

    // Esc chiude senza fare niente; vuoto e soli spazi non partono.
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-rinomina')).toHaveCount(0);
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(campo).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
    await campo.fill('   ');
    await page.locator('.sn-rinomina-ok').click();
    await expect(page.locator('.sn-rinomina-stato')).toHaveText('Scrivi un nome');
    expect(readdirSync(dir).sort()).toEqual(['Bolletta marzo (2).pdf', 'Bolletta marzo.pdf']);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('negli Scaricamenti: «Dai un nome sensato», la voce segue il file, e «Rimetti il nome di prima»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await modelloDeiNomi(app);
  const { rec, chiudi } = await scarica('scan_00231.pdf', BOLLETTA, { shell, openTab, testServer });
  try {
    const dl = await openTab('filo://downloads/downloads.html');
    const voce = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'scan_00231.pdf' }) });
    await expect(voce).toBeVisible({ timeout: 10000 });
    await voce.click({ button: 'right' });
    await dl.locator('.dl-ctxmenu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(dl.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
    await dl.locator('.sn-rinomina-ok').click();
    await expect(dl.locator('.sn-rinomina-esito-testo')).toHaveText(`Rinominato: ${NOME_NUOVO}`);

    const nuovo = join(rec.savePath, '..', NOME_NUOVO);
    expect(existsSync(nuovo)).toBe(true);
    expect(existsSync(rec.savePath)).toBe(false);
    // La voce non diventa «non più sul disco»: segue il file e si apre ancora.
    const rinominata = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: NOME_NUOVO }) });
    await expect(rinominata).toBeVisible({ timeout: 10000 });
    await expect(rinominata).not.toHaveAttribute('data-missing', '1');
    await expect(rinominata.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible();
    // La ricerca lo trova anche col nome con cui era arrivato.
    await dl.locator('#search').fill('scan_00231');
    await expect(rinominata).toBeVisible();
    await dl.locator('#search').fill('');
    await dl.screenshot({ path: join(SHOTS, 'rinomina-scaricamenti.png') });

    // Chiuso il riquadro, il nome di prima resta a un tasto destro di distanza.
    await dl.keyboard.press('Escape');
    await rinominata.click({ button: 'right' });
    await dl.locator('.dl-ctxmenu .sn-select-option', { hasText: 'Rimetti il nome di prima' }).click();
    await expect(dl.locator('.dl-item .dl-name', { hasText: 'scan_00231.pdf' })).toBeVisible({ timeout: 10000 });
    expect(existsSync(rec.savePath)).toBe(true);
    expect(existsSync(nuovo)).toBe(false);
  } finally { await chiudi(); }
});

test('in chat: «rinomina i file in Download» mostra vecchio → nuovo, rinomina solo dopo l\'OK, «Annulla» rimette tutto', async ({ app }) => {
  test.setTimeout(120_000);
  const dir = cartellaInCasa('filo-nomi-chat-');
  writeFileSync(join(dir, 'scan_00231.pdf'), BOLLETTA);
  writeFileSync(join(dir, 'scan_00232.pdf'), pdfConTesto(['Contratto affitto', 'Via Roma 12', 'Firmato il 3 marzo']));
  writeFileSync(join(dir, 'Contratto vecchio.pdf'), pdfConTesto(['Non toccarmi', 'Ho un nome']));
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ cartella: dir }) }] },
      { text: 'Ti ho preparato i nomi nuovi.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'rinomina i file in quella cartella con nomi che abbiano senso');

    // Il popup si apre da solo con l'elenco: finché non si risponde, sul disco non cambia niente.
    await expect.poll(() => confirmText(page), { timeout: 20000 }).toContain('«scan_00231.pdf» → «Bolletta luce Enel Marzo 2026.pdf»');
    const testo = await confirmText(page);
    expect(testo).toContain('«scan_00232.pdf» → «Contratto affitto Via Roma 12.pdf»');
    expect(testo).not.toContain('Contratto vecchio');
    expect(readdirSync(dir).sort()).toEqual(['Contratto vecchio.pdf', 'scan_00231.pdf', 'scan_00232.pdf']);
    await page.screenshot({ path: join(SHOTS, 'rinomina-chat-conferma.png') });

    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-action-btn', { hasText: 'Rinominati 2 file' })).toBeVisible({ timeout: 15000 });
    expect(readdirSync(dir).sort()).toEqual(['Bolletta luce Enel Marzo 2026.pdf', 'Contratto affitto Via Roma 12.pdf', 'Contratto vecchio.pdf']);
    await page.screenshot({ path: join(SHOTS, 'rinomina-chat-fatto.png') });

    await page.locator('.dash-action-btn', { hasText: 'Annulla' }).click();
    await expect(page.locator('.dash-action-btn', { hasText: 'Nomi di prima rimessi' })).toBeVisible({ timeout: 10000 });
    expect(readdirSync(dir).sort()).toEqual(['Contratto vecchio.pdf', 'scan_00231.pdf', 'scan_00232.pdf']);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('in chat, l\'utente che dice no: niente cambia sul disco', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-nomi-no-');
  writeFileSync(join(dir, 'scan_00231.pdf'), BOLLETTA);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ percorsi: [join(dir, 'scan_00231.pdf')] }) }] },
      { text: 'Ecco la proposta.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'dagli un nome sensato');
    await expect.poll(() => confirmText(page), { timeout: 20000 }).toContain('Bolletta luce Enel Marzo 2026.pdf');
    await clickConfirm(page, 'cancel');
    await page.waitForTimeout(500);
    expect(readdirSync(dir)).toEqual(['scan_00231.pdf']);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('in chat, una cartella dove ogni file ha già un nome: niente da confermare, e lo dice', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-nomi-pieni-');
  writeFileSync(join(dir, 'Contratto vecchio.pdf'), BOLLETTA);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ cartella: dir }) }] },
      { text: 'Hanno già nomi chiari.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'rinomina i file di quella cartella');
    await expect(page.locator('.dash-bubble', { hasText: 'Hanno già nomi chiari.' })).toBeVisible({ timeout: 15000 });
    expect(await confirmText(page)).toBe('');
    const consegnato = (await app.evaluate(() => globalThis.__chatFinta_calls)).map((m) => JSON.stringify(m)).join('\n');
    expect(consegnato).toContain('Nessun file rinominato');
    expect(readdirSync(dir)).toEqual(['Contratto vecchio.pdf']);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un file trascinato dove si scrive: entra col percorso, e dal tasto destro gli si dà un nome prima di mandarlo', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-nomi-drop-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, BOLLETTA);
  try {
    await modelloFinto(app, [{ text: 'Ricevuto.' }]);
    await modelloDeiNomi(app);
    const page = await home(app);
    // Il percorso di un file trascinato lo dà il sistema (webUtils): un File creato dalla prova non ne ha uno.
    await page.evaluate((p) => {
      window.filo.percorsoDelFile = () => p;
      const dt = new DataTransfer();
      dt.items.add(new File(['%PDF'], 'scan_00231.pdf', { type: 'application/pdf' }));
      document.getElementById('inputForm').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, vecchio);
    const chip = page.locator('.dash-file-chip');
    await expect(chip).toHaveText(/scan_00231\.pdf/);
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
    await page.locator('.sn-rinomina-ok').click();
    await expect(chip).toHaveText(/Bolletta luce Enel Marzo 2026\.pdf/);
    expect(existsSync(join(dir, NOME_NUOVO))).toBe(true);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: join(SHOTS, 'rinomina-trascinato.png') });

    await chiedi(page, 'cos\'è?');
    await expect(page.locator('.dash-bubble', { hasText: `File: ${join(dir, NOME_NUOVO)}` })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.dash-file-chip')).toHaveCount(0);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acceso in Preferenze, uno scaricamento col nome che non dice niente prende un nome sensato da solo, con «Annulla»', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  await modelloDeiNomi(app);
  const pref = await openTab('filo://preferences/preferences.html');
  const casella = pref.locator('#nomiSensatiScaricamenti');
  await expect(casella).not.toBeChecked();
  await casella.check();
  await expect.poll(() => app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return !!(s.nomiSensati && s.nomiSensati.scaricamenti);
  })).toBe(true);
  await pref.locator('#sec-nomi-file').screenshot({ path: join(SHOTS, 'rinomina-preferenze.png') });
  const { rec, chiudi } = await scarica('scan_00999.pdf', BOLLETTA, { shell, openTab, testServer });
  try {
    const nuovo = join(rec.savePath, '..', NOME_NUOVO);
    // Il nome nuovo nasce un attimo prima che il vecchio sparisca (mai sovrascrivere): si aspetta l'insieme.
    await expect.poll(() => existsSync(nuovo) && !existsSync(rec.savePath), { timeout: 20000 }).toBe(true);
    const vista = await avvisi();
    const annulla = vista.locator('.shell-notif-action', { hasText: 'Annulla' }).last();
    await expect(annulla).toBeVisible({ timeout: 10000 });
    await annulla.click();
    await expect.poll(() => existsSync(rec.savePath) && !existsSync(nuovo), { timeout: 10000 }).toBe(true);
  } finally { await chiudi(); }
});
