// Verifica #1403.79 giro 1: due PIN nella stessa frase, il secondo dopo qualche parola, un trattino o un a capo.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

const FRASI = [
  // Gli esempi della segnalazione: qui devono restare tolti tutti e due.
  ['Il pin è 4829 e 1234', '4829', '1234'],
  ['I pin sono 4830 e 1235', '4830', '1235'],
  // Il secondo PIN dopo qualche parola, un segno o un a capo.
  ['Il pin del bancomat è 4831 e quello della SIM è 1236', '4831', '1236'],
  ['Il pin è 4832 e il secondo è 1237', '4832', '1237'],
  ['Il pin è 4833 e anche 1238', '4833', '1238'],
  ['PIN carta 4834, telefono 1239', '4834', '1239'],
  ['pin: 4835 - 1240', '4835', '1240'],
  ['Il pin è 4836\ne 1241', '4836', '1241'],
];

test('r1 il secondo PIN detto nella stessa frase non arriva al modello anche con parole, un trattino o un a capo in mezzo', async ({ app }) => {
  test.setTimeout(120_000);
  const pagina = await home(app);
  await modelloFinto(app, [{ text: 'RICEVUTO' }]);
  try {
    for (const [frase, primo, secondo] of FRASI) {
      const prima = (await chiamateAlModello(app)).length;
      await chiedi(pagina, `${frase} (prova)`);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20_000 }).toBeGreaterThan(prima);
      const mandato = JSON.stringify((await chiamateAlModello(app)).slice(prima));
      expect(mandato, `«${frase}» è arrivata al modello`).toContain('(prova)');
      expect.soft(mandato, `«${frase}»: il primo PIN`).not.toContain(primo);
      expect.soft(mandato, `«${frase}»: il secondo PIN`).not.toContain(secondo);
      await expect(pagina.locator('.dash-bubble-filo', { hasText: 'RICEVUTO' })).toHaveCount(FRASI.indexOf(FRASI.find((f) => f[0] === frase)) + 1, { timeout: 20_000 });
    }
  } finally {
    await ripristina(app);
  }
});
