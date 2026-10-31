// #1488 — la firma degli autori di yt-dlp si verifica con la chiave fissata in Filo. I dati sono veri: SHA2-256SUMS e
// SHA2-256SUMS.sig del rilascio del 26/10/2026, come li pubblica yt-dlp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = require(join(ROOT, 'src', 'main', 'services', 'firmaPgp.js'));

const SOMME = Buffer.from(`e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3  yt-dlp
f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d  yt-dlp.exe
21f942d258d25cc4e60b4982a25c423460f0bebb835f38e6dfd1fcb140087f95  yt-dlp.tar.gz
0066dbac3c124028e2dcae2a197fccee33cd91f456313d24f7af89fd54590e98  yt-dlp_arm64.exe
767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795  yt-dlp_linux
f34053415136e55073dd64ba5326d161ecc23ce0e98c081d8752867b37809450  yt-dlp_linux.zip
e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483  yt-dlp_linux_aarch64
74708e707e8fa8177c8347e58152337edf320149cd7b225defd453f7cde47822  yt-dlp_linux_aarch64.zip
ec828c26c6da7898b279da2cad3dca434ebec7f8f18ae7b6420027f3aa037bf2  yt-dlp_linux_armv7l.zip
0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa  yt-dlp_macos
20d98fa608998eff87d1d35a6e9fb65e4b874639a6cc89addc19da3becde3ef1  yt-dlp_macos.zip
e97a4dd919221d233e7720e18fa3f66db60fbd1d8c0846bf6deb8e88e04475a8  yt-dlp_musllinux
c3a67f7c14d4cbf876e7801039237fc16b929a629c72f9c785ec3fdc8aa40748  yt-dlp_musllinux.zip
ea97b8564667f3cabc334c3216526de39bc684e99815ecf07b6642f4cba8af4d  yt-dlp_musllinux_aarch64
1648beeb7b0c78b471654262697066c016783d33813659367a5c274828ba3240  yt-dlp_musllinux_aarch64.zip
fd51b212cf8380c7a52ee08c0d6be7f3c59b2f2c832eaf7b45acfae6eab57419  yt-dlp_win.zip
5eaa4c61f3c09189f3a551bf1855c13aad61fb865cc33f06012a6c2dbe287a45  yt-dlp_win_arm64.zip
e2898afd51c029d23c58de60cd8446b110dd3aa121b3e4149bafcee3356c59c0  yt-dlp_win_x86.zip
c0407c66361f50a99e10949ae882ea2ad7de9086b75d226d8fd88da4f74828fa  yt-dlp_x86.exe
`, 'utf8');
const FIRMA = Buffer.from('iQIzBAABCgAdFiEErAy75oSNaoc0ZK9OV89lkztadYEFAmrf0ykACgkQV89lkztadYFrgRAAi88f07ETAUGIzH/ifgZLMdYcQavMpBw5GsbCi4Os7K2+MJNZgJ1SpTYa/qQZ0GPS+RCsebOPcbByTAt9OSjnN7ZzJVPbl8B/FioDRWBond7Z3JvZojU28Xv6dd0YGv7sw0pNit1Rro+9qtxQ1ibiNlqZHyj8BHyANOvSNNRLJuVmDkXWirmQwAjHnTmnK3Qcg2dOmuQr5DX/XbeNqzxxcqphUO7upijylfOtVQyKoY91ze41k0XE4H1e+jdn8OuZEZhw2h/UEk9EX5ENn6jAqOPN3c0t33vUgZqYUliDnYogSC2ITb8tbsxdMRnQG5HouYLHVK56aPClkx5sm/891XpwYw2xF8RIqqDEt9yf+V0xbd2rJBOvjQmPMJ6iLUbaBI440VRaJDd5ZEkMAGd+O8xxMQ+xf/SvPpFM8ytAgxk+B76xTYv/2Z9FiMC08Au0iXkEaJ72ws/i0Ly55BvZ8bbON3yMrk64WG3JHoQo0xF+1K1YuWjpXxkesseLlj6fPcNlcAKjK2mzKV5EQe+ZPdCzWy4+BM3tQybyrUkHYQkJnCUad1a2/ufpnZFy1sFm/SM+o71Sf3qLYFz/BP6RVSnChN5DvuxN+hPZfL4dqubxUIXZAAYxt1dss2NhqBc7BdhbetJwmt/foI8NLAiKYp6D5Rhv1zhdajQta+BlF78=', 'base64');

test('la chiave fissata è quella con cui yt-dlp firma i rilasci', () => {
  assert.equal(F.chiavePubblica(F.CHIAVE_YTDLP).impronta, 'AC0CBBE6848D6A873464AF4E57CF65933B5A7581');
});

test('la firma vera di SHA2-256SUMS passa', () => {
  assert.equal(F.verifica(SOMME, FIRMA), true);
});

test('un hash cambiato di una cifra non passa più', () => {
  const t = Buffer.from(SOMME);
  t[3] = t[3] === 0x30 ? 0x31 : 0x30;
  assert.equal(F.verifica(t, FIRMA), false);
});

test('una firma rovinata, vuota o di un altro formato non passa e non lancia', () => {
  const r = Buffer.from(FIRMA);
  r[r.length - 5] ^= 0xff;
  assert.equal(F.verifica(SOMME, r), false);
  assert.equal(F.verifica(SOMME, Buffer.alloc(0)), false);
  assert.equal(F.verifica(SOMME, 'non è una firma'), false);
  assert.equal(F.verifica(SOMME, Buffer.from([0x89, 0xff, 0xff, 1, 2])), false);
});

// Una firma valida ma fatta da un'altra chiave RSA: costruita qui, nello stesso formato di quella vera.
test('una firma corretta ma di un\'altra chiave non passa', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const c = Buffer.from(FIRMA.subarray(3));
  const lenH = c.readUInt16BE(4);
  const testa = c.subarray(0, 6 + lenH);
  const coda = Buffer.alloc(6); coda[0] = 4; coda[1] = 0xff; coda.writeUInt32BE(6 + lenH, 2);
  const s = sign('sha512', Buffer.concat([SOMME, testa, coda]), privateKey);
  const lenU = c.readUInt16BE(6 + lenH);
  const resto = c.subarray(6 + lenH, 8 + lenH + lenU);
  const corpo = Buffer.concat([testa, resto, Buffer.from([0, 0]), Buffer.from([(s.length * 8) >> 8, (s.length * 8) & 0xff]), s]);
  const pacchetto = Buffer.concat([Buffer.from([0x89, corpo.length >> 8, corpo.length & 0xff]), corpo]);
  assert.equal(F.verifica(SOMME, pacchetto), false, 'porta l\'impronta di yt-dlp ma non è sua');
});
