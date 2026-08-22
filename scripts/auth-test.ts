/**
 * auth-test.ts — unit checks for src/lib/auth.ts (no DB involved).
 * Verifies JWT round-trip, header-only token extraction, and the TOTP
 * implementation against RFC 6238 Appendix B test vectors.
 */
import {
  signToken,
  verifyToken,
  extractToken,
  generateTotpSecret,
  totpCodeAt,
  verifyTotp,
  totpProvisioningUri,
  hashPassword,
  verifyPassword,
} from '../src/lib/auth';

const results: string[] = [];
let failed = false;

function check(name: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

async function main() {
  // ── JWT ────────────────────────────────────────────────────────────────────
  const token = await signToken({ sub: '42', email: 'a@b.c' });
  const payload = await verifyToken(token);
  check('jwt round-trip', payload?.sub === '42' && payload?.email === 'a@b.c');
  check('jwt rejects garbage', (await verifyToken('not-a-token')) === null);
  check('jwt rejects tampered', (await verifyToken(token.slice(0, -2) + 'xx')) === null);

  const headerReq = new Request('http://x/', { headers: { Authorization: 'Bearer abc' } });
  check('extractToken reads bearer header', extractToken(headerReq) === 'abc');
  const urlReq = new Request('http://x/?token=abc');
  check('extractToken ignores query token', extractToken(urlReq) === null);

  // ── Password hashing ───────────────────────────────────────────────────────
  const hash = await hashPassword('correct horse');
  check('bcrypt hash + verify', await verifyPassword('correct horse', hash));
  check('bcrypt rejects wrong password', !(await verifyPassword('wrong', hash)));
  check('bcrypt rejects placeholder hash', !(await verifyPassword('anything', 'google-oauth')));

  // ── TOTP against RFC 6238 Appendix B (SHA-1) ───────────────────────────────
  // Key "12345678901234567890" in base32; documented 8-digit codes, truncated
  // to the 6 digits we use: 94287082 -> 287082, 07081804 -> 081804.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  check('rfc vector t=59s', totpCodeAt(RFC_SECRET, 59_000) === '287082', totpCodeAt(RFC_SECRET, 59_000) ?? 'null');
  check('rfc vector t=1111111109s', totpCodeAt(RFC_SECRET, 1_111_111_109_000) === '081804', totpCodeAt(RFC_SECRET, 1_111_111_109_000) ?? 'null');

  const secret = generateTotpSecret();
  check('generated secret is base32', /^[A-Z2-7]{32}$/.test(secret), secret);
  const nowCode = totpCodeAt(secret, Date.now())!;
  check('verifyTotp accepts current code', verifyTotp(secret, nowCode));
  check('verifyTotp rejects wrong code', !verifyTotp(secret, String((Number(nowCode) + 1) % 1_000_000).padStart(6, '0')));
  check('verifyTotp rejects bad secret', !verifyTotp('', '123456'));
  check('verifyTotp rejects non-digit input', !verifyTotp(secret, 'abc123'));

  const uri = totpProvisioningUri(secret, 'a@b.c');
  check('provisioning uri format', uri.startsWith('otpauth://totp/') && uri.includes(`secret=${secret}`) && uri.includes('digits=6'));
}

main()
  .catch((e) => {
    failed = true;
    results.push(`FAIL  unexpected error — ${(e as Error).message}`);
  })
  .finally(() => {
    console.log(results.join('\n'));
    process.exit(failed ? 1 : 0);
  });
