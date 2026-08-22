/**
 * check-uploads.ts
 * Regression checks for the two upload guards in
 * src/lib/application-documents.ts.
 *
 * safeFilename() matters beyond tidiness: the filename comes from a client
 * upload and the local booking watcher writes it to a real filesystem, so a
 * name like `..\..\Windows\System32\evil.dll` must not survive as a path.
 *
 * Run: npm run check:uploads
 */
import { safeFilename, validateUpload, MAX_DOCUMENT_BYTES } from '../src/lib/application-documents';

// Backslash built at runtime so no layer of shell/tooling escaping can alter it.
const B = String.fromCharCode(92);

let pass = 0;
let fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`),
  );
};

const file = (name: string, type: string, size: number) => ({ name, type, size }) as File;

console.log('--- validateUpload ---');
check('valid pdf', validateUpload(file('a.pdf', 'application/pdf', 1024)).ok, true);
check('valid jpeg', validateUpload(file('a.jpg', 'image/jpeg', 1024)).ok, true);
check('valid png', validateUpload(file('a.png', 'image/png', 1024)).ok, true);
check('empty file rejected', validateUpload(file('a.pdf', 'application/pdf', 0)).ok, false);
check('oversize rejected', validateUpload(file('a.pdf', 'application/pdf', MAX_DOCUMENT_BYTES + 1)).ok, false);
check('exactly at limit allowed', validateUpload(file('a.pdf', 'application/pdf', MAX_DOCUMENT_BYTES)).ok, true);
check('exe rejected', validateUpload(file('x.exe', 'application/x-msdownload', 100)).ok, false);
check('svg rejected', validateUpload(file('x.svg', 'image/svg+xml', 100)).ok, false);
check('html rejected', validateUpload(file('x.html', 'text/html', 100)).ok, false);
check('blank mime rejected', validateUpload(file('x', '', 100)).ok, false);

console.log('\n--- safeFilename (the watcher writes this name to disk) ---');
check('plain name kept', safeFilename('letter.pdf'), 'letter.pdf');
check('posix traversal stripped', safeFilename('../../.ssh/authorized_keys'), 'authorized_keys');
check(
  'windows traversal stripped',
  safeFilename(['..', '..', 'Windows', 'System32', 'evil.dll'].join(B)),
  'evil.dll',
);
check('mixed separators stripped', safeFilename('..' + B + '../secrets/' + B + 'id_rsa'), 'id_rsa');
check('absolute posix path stripped', safeFilename('/etc/passwd'), 'passwd');
check('drive path stripped', safeFilename('C:' + B + 'Users' + B + 'me' + B + 'x.pdf'), 'x.pdf');
check('leading dots stripped', safeFilename('...hidden'), 'hidden');
check('bare traversal falls back', safeFilename('../..'), 'document');
check('reserved chars stripped', safeFilename('a<b>c:d"e|f?g*h.pdf'), 'abcdefgh.pdf');
check('empty falls back', safeFilename(''), 'document');
check('long name truncated to 120', safeFilename('x'.repeat(500)).length, 120);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
