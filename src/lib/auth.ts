import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALG = 'HS256';
const EXPIRY = '7d';
const DEV_SECRET = new TextEncoder().encode('dev-secret-change-me');

/**
 * The token secret, resolved lazily so a production build never hard-fails at
 * module evaluation when the env var is injected at runtime.
 *
 * In production a missing JWT_SECRET is fatal: falling back to a public
 * constant would let anyone forge tokens, including admin ones. In
 * development the fallback keeps local startup frictionless — loudly.
 */
let cachedSecret: Uint8Array | null = null;

function tokenSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const secret = process.env.JWT_SECRET;
  if (secret) {
    cachedSecret = new TextEncoder().encode(secret);
    return cachedSecret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set — refusing to sign tokens with a public fallback secret.');
  }
  console.warn('[auth] JWT_SECRET is not set — using a development-only fallback secret.');
  cachedSecret = DEV_SECRET;
  return cachedSecret;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: Record<string, unknown>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(tokenSecret());
}

export async function verifyToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, tokenSecret());
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Bearer header only. Tokens in URL query strings leak into proxy logs,
 * browser history and referrer headers — the client sends the Authorization
 * header on every authenticated call (see utils/api.ts), so the query-param
 * fallback the legacy backend used is gone.
 */
export function extractToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) — dependency-free, so the MFA check the legacy backend did
// with pyotp works against the same stored secrets without a new package.
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

export function generateTotpSecret(length = 20): string {
  const bytes = randomBytes(length);
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[\s=-]/g, '');
  let buffer = 0;
  let bits = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val === -1) continue;
    buffer = (buffer << 5) | val;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: number): Buffer {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return Buffer.from(String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0'));
}

/** The 6-digit code for a given moment — exported so tests can hit RFC 6238 vectors. */
export function totpCodeAt(secret: string, timeMs: number): string | null {
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }
  if (!key.length) return null;
  const counter = Math.floor(timeMs / 1000 / TOTP_PERIOD);
  return hotp(key, counter).toString('utf8');
}

/** Accepts the current 30-second code plus the one on each side, like pyotp. */
export function verifyTotp(secret: string, code: string, window = TOTP_WINDOW): boolean {
  const trimmed = String(code ?? '').trim();
  if (!secret || !/^\d{6}$/.test(trimmed)) return false;

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  if (!key.length) return false;

  const now = Date.now();
  const provided = Buffer.from(trimmed);
  for (let offset = -window; offset <= window; offset++) {
    const expected = totpCodeAt(secret, now + offset * TOTP_PERIOD * 1000);
    if (expected && timingSafeEqual(provided, Buffer.from(expected))) return true;
  }
  return false;
}

/** The otpauth:// URI authenticator apps scan to add the account. */
export function totpProvisioningUri(secret: string, email: string, issuer = 'TurkGateway'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}
