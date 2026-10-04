// Esplorazione del giro 2 di #950: scansione vera (JPEG dentro il PDF), immagine, nomi strani in chat, tema scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { cartellaTemporanea, cartellaInCasa } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { confirmText, clickConfirm } from '../../helpers/confirm.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');

function pdfConJpeg(jpeg, w, h) {
  const content = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q\n`);
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('endstream')]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  let len = parts[0].length;
  const pos = [];
  objs.forEach((o, i) => { pos.push(len); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); parts.push(b); len += b.length; });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`));
  return Buffer.concat(parts);
}

async function jpeg(app, w, h) {
  const b64 = await app.evaluate(({ nativeImage }, [w, h]) => {
    const px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) { px[i * 4] = 40; px[i * 4 + 1] = (i % w) % 256; px[i * 4 + 2] = 200; px[i * 4 + 3] = 255; }
    return nativeImage.createFromBitmap(px, { width: w, height: h }).toJPEG(80).toString('base64');
  }, [w, h]);
  return Buffer.from(b64, 'base64');
}

async function modelloCheVede(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const u = messages.find((m) => m.role === 'user');
      const img = Array.isArray(u.content) ? u.content.find((p) => p.type === 'image_url') : null;
      globalThis.__visti.push({ img: img ? img.image_url.url.slice(0, 30) : '', len: img ? img.image_url.url.length : 0 });
      return { text: img ? 'Scansione ricevuta condominio' : 'Bolletta prova', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

test('scansione JPEG dentro un PDF e foto: il modello riceve la pagina come immagine', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-v950-');
  const scan = join(dir, 'scan_00231.pdf');
  writeFileSync(scan, pdfConJpeg(await jpeg(app, 1240, 1754), 1240, 1754));
  const foto = join(dir, 'IMG_20260301_1012.jpg');
  writeFileSync(foto, await jpeg(app, 3000, 2000));
  try {
    await modelloFinto(app, [
      { toolCalls: [
        { id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: scan, etichetta: 'scan_00231.pdf' }) },
        { id: 'f2', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: foto, etichetta: 'IMG_20260301_1012.jpg' }) },
      ] },
      { text: 'Eccoli.' },
    ]);
    await modelloCheVede(app);
    const page = await home(app);
    await chiedi(page, 'trova le scansioni');
    const c1 = page.locator('a.dash-action-btn', { hasText: 'scan_00231.pdf' });
    await expect(c1).toBeVisible({ timeout: 15000 });
    await c1.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Scansione ricevuta condominio', { timeout: 20000 });
    await page.keyboard.press('Escape');
    const c2 = page.locator('a.dash-action-btn', { hasText: 'IMG_20260301_1012.jpg' });
    await c2.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Scansione ricevuta condominio', { timeout: 20000 });
    const visti = await app.evaluate(() => globalThis.__visti);
    console.log('VISTI', JSON.stringify(visti));
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nomi con markup e emoji nel popup della chat, e tema scuro del riquadro', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-v950-strani-');
  const strano = join(dir, '<img src=x onerror="window.__xss=1"> 🎉 scan.pdf');
  writeFileSync(strano, 'testo qualunque di prova');
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ percorsi: [strano] }) }] },
      { text: 'Ecco.' },
    ]);
    await modelloCheVede(app);
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
    const page = await home(app);
    await chiedi(page, 'dagli un nome');
    await expect.poll(() => confirmText(page), { timeout: 20000 }).toContain('Bolletta prova.pdf');
    console.log('CONFERMA', await confirmText(page));
    await page.screenshot({ path: join(SHOTS, 'v950-conferma-scuro.png') });
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-action-btn', { hasText: 'Rinominato un file' })).toBeVisible({ timeout: 15000 });
    expect(readdirSync(dir)).toEqual(['Bolletta prova.pdf']);
    await page.screenshot({ path: join(SHOTS, 'v950-fatto-scuro.png') });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
