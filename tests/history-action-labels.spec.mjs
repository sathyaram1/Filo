import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

// Feedback #272: nella pagina Cronologia AI alcune azioni (descrivi immagine,
// trascrizione vocale/OCR, modifica testo, spiega link) comparivano col loro
// codice interno grezzo (es. 'describe_image') invece di un'etichetta leggibile,
// e mancavano dal menu "filtra per tipo".
//
// Test: pre-carichiamo in cronologia una voce per ognuna di queste azioni,
// apriamo filo://history/history.html e verifichiamo che:
//   - ogni voce mostra l'etichetta italiana, MAI il codice grezzo;
//   - il menu filtro contiene un'opzione (con etichetta leggibile) per ognuna;
//   - filtrando per un tipo la lista si restringe a quelle voci.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findTabPage(app, hostname, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

const RAW_CODES = ['describe_image', 'transcribe_image', 'transcribe_audio', 'edit_text', 'explain_link'];

test('history page shows readable labels and filter options for all action types', async () => {
  const now = Date.now();
  const aiHistory = RAW_CODES.map((action, i) => ({
    id: `h-${i}`,
    timestamp: new Date(now - i * 1000).toISOString(),
    action,
    provider: 'openrouter',
    model: 'gemini-2.0-flash',
    input: { selection: `testo di prova numero ${i}` },
    output: `risposta di prova numero ${i}`,
    origin: 'https://example.com',
    costEur: 0.0001,
  }));

  const userData = mkdtempSync(join(tmpdir(), 'filo-hist-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ aiHistory }), 'utf8');

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    const page = await findTabPage(app, 'history');
    expect(page, 'la pagina cronologia deve aprirsi').toBeTruthy();
    await page.waitForLoadState('domcontentloaded');

    // Le voci sono renderizzate.
    await expect(page.locator('.sn-history-item')).toHaveCount(RAW_CODES.length);

    // La riga-etichetta di ogni voce mostra il nome leggibile, MAI il codice
    // grezzo (l'etichetta è nella meta, prima del "•").
    const metaText = (await page.locator('.sn-history-meta').allInnerTexts()).join('\n');
    for (const code of RAW_CODES) {
      expect(metaText, `il codice grezzo ${code} non deve comparire nell'etichetta`).not.toContain(code);
    }
    // Le etichette leggibili attese ci sono.
    for (const label of ['Descrivi immagine', 'Trascrivi immagine (OCR)', 'Dettatura', 'Modifica testo', 'Spiega link']) {
      expect(metaText).toContain(label);
    }

    // Il menu filtro contiene un'opzione per ogni tipo presente (value = codice,
    // testo = etichetta leggibile), più "Tutte".
    const options = await page.locator('#filter option').evaluateAll((els) =>
      els.map((el) => ({ value: el.value, text: el.textContent })));
    expect(options[0].value).toBe(''); // "Tutte"
    for (const code of RAW_CODES) {
      const opt = options.find((o) => o.value === code);
      expect(opt, `opzione filtro mancante per ${code}`).toBeTruthy();
      expect(opt.text).not.toBe(code); // etichetta leggibile, non codice grezzo
      expect(opt.text.length).toBeGreaterThan(0);
    }

    // Filtrando per un tipo, la lista mostra solo quelle voci.
    await page.selectOption('#filter', 'edit_text');
    await expect(page.locator('.sn-history-item')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText('Modifica testo');
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
