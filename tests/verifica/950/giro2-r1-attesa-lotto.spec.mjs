// #950 giro 2, rilievo 1: mentre Filo legge i file per proporre i nomi in chat, la riga d'attesa dice che sta
// leggendo i file per dar loro un nome, non un generico «Eseguo un'azione…».
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { confirmText } from '../../helpers/confirm.mjs';

test('chat, lotto di file: durante la lettura la riga d\'attesa parla dei file, non di un\'azione qualunque', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-v950-attesa-');
  for (let i = 1; i <= 3; i++) writeFileSync(join(dir, `scan_0023${i}.txt`), `Documento numero ${i}`);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ cartella: dir }) }] },
      { text: 'Ecco i nomi.' },
    ]);
    await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({ models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' } });
      let k = 0;
      globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
        await new Promise((r) => setTimeout(r, 4000));
        k += 1;
        return { text: `Documento numero ${k}`, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      };
    });
    const page = await home(app);
    await chiedi(page, 'rinomina i file di quella cartella con nomi sensati');
    await page.waitForTimeout(1500);
    expect(await confirmText(page)).toBe('');
    const righe = (await page.locator('body').innerText()).split('\n').map((r) => r.trim())
      .filter((r) => r && !r.includes('rinomina i file di quella cartella'));
    expect(righe.join('\n')).not.toMatch(/Eseguo un.azione/);
    expect(righe.some((r) => /file/i.test(r))).toBe(true);
    await expect.poll(() => confirmText(page), { timeout: 30000 }).toContain('Documento numero');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
