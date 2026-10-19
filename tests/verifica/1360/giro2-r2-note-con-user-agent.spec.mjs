// Verifica #1360 giro 2, rilievo 2: una nota che cita un user agent accanto a due parole di spiegazione non è una copia.
import { test, expect } from '../../fixtures/electron.mjs';
import { motivoContenuto } from '../../../scripts/lib/copie-di-dati.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UAF = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
const copia = (f, t) => motivoContenuto(f, Buffer.from(t));

test('r2 un file di pattern con la tabella degli user agent da provare resta salvabile', () => {
  const t = `# Siti che rifiutano Electron\n\n| Caso | User agent |\n|---|---|\n| Chrome su Windows, quello che mandiamo | ${UA} |\n| Firefox su Linux per le prove | ${UAF} |\n`;
  expect(copia('patterns/siti-che-rifiutano-electron.md', t)).toBe('');
});

test('r2 un appunto con un user agent e la sua spiegazione resta salvabile', () => {
  expect(copia('scripts/note-ua.txt', `${UA}, usato dal fetch della pagina di prova quando il sito rifiuta\n`)).toBe('');
});

test('r2 un elenco JSON di user agent con una descrizione resta salvabile', () => {
  expect(copia('tests/verifica/ua.json', JSON.stringify([UA, 'il sito di prova rifiuta questo user agent']))).toBe('');
});
