/**
 * check-turkmen.mjs
 * Measures how much Turkish (and other non-Turkmen) vocabulary leaks into the
 * agent's Turkmen replies.
 *
 * Turkmen and Turkish are close relatives and Qwen's Turkmen training data is
 * thin, so the model drifts into Turkish. Judging that by eyeballing a single
 * reply is not reliable — this gives a repeatable number so prompt/filter
 * changes can be compared before and after.
 *
 * Needs a dev server running (npm run dev).
 * Run: node scripts/check-turkmen.mjs [--base http://localhost:3000] [--json]
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '.env.local');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const argv = process.argv.slice(2);
const BASE = (argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null) || 'http://localhost:3000';
const AS_JSON = argv.includes('--json');
const SAVE = argv.includes('--save') ? argv[argv.indexOf('--save') + 1] : null;

// ---------------------------------------------------------------------------
// Detector list — deliberately BROADER than the auto-correct lexicon, because
// this has to catch leaks we have not fixed yet (including the ambiguous ones
// that are intentionally never auto-corrected).
//
// Only unambiguously non-Turkmen forms belong here. Words that are valid in
// both languages (gerek, üçin, bolsa, we...) must NOT be listed or the score
// becomes meaningless.
// ---------------------------------------------------------------------------
// NOTE: every entry must be a form that is Turkish and NEVER valid Turkmen.
// Words shared by both languages (bir, bu, şu, gerek, üçin, bolsa, köp...) are
// deliberately excluded — including them would inflate the score into noise.
const TURKISH_MARKERS = [
  // function words — Turkmen uses we / ýa-da / bilen / ýagny / däl / emma
  've', 'veya', 'ile', 'yani', 'değil', 'ancak', 'ayrıca',
  'için', 'hangi', 'olarak', 'sonra', 'önce', 'kadar', 'çok',
  // Turkish verb forms — Turkmen conjugates differently
  'gerekir', 'gerekiyor', 'gerekmektedir', 'gerekmez', 'bulunmaktadır',
  'olabilir', 'yapmalısınız', 'zorundasınız',
  'istiyorsunuz', 'istiyor', 'ediyor', 'ediyorsunuz', 'yapıyor',
  // nouns the model keeps leaking
  'belediye', 'belediyeden', 'belediyesi', 'belediyesinden', 'belediyesine', 'belediyeye',
  'hastane', 'hastaneler', 'hastaneden', 'hastanelerden',
  'şirket', 'şirketi', 'şirketler',
  'başvuru', 'başvurusu', 'başvuruda',
  'belge', 'belgesi', 'belgeler', 'belgeleri', 'belgelerin',
  'sigorta', 'sigortası', 'sigortanın',
  'fotoğraf', 'fotoğraflar', 'fotograf',
  'kopya', 'kopyası',
  'kontrat', 'sözleşme', 'sözleşmesi',
  'üniversite', 'üniversitesi', 'üniversiteye',
  'yaklaşık', 'ilçe', 'ilçede', 'ilçeden', 'semt', 'semtte',
  'kişi', 'kişiler', 'işletmek', 'işletme',
  'yurt dışı', 'yurtdışı', 'yurt dışında', 'yurtdışında',
  // non-Turkish, non-Turkmen leaks seen in the wild
  'квитанция', 'документ',
  'student', 'passport', 'document', 'application', 'required',
];

// Turkish-only grammatical endings. Turkmen uses -ýar/-ýär for the present
// continuous, never -iyor/-ıyor, so these are a reliable signal.
const TURKISH_SUFFIX_PATTERNS = [
  /\w+iyor\b/gi,
  /\w+ıyor\b/gi,
  /\w+uyor\b/gi,
  /\w+üyor\b/gi,
  /\w+mektedir\b/gi,
  /\w+maktadır\b/gi,
];

// Official Turkish proper nouns. These are CORRECT as Turkish and must not be
// counted as contamination — they are institution and document names.
const PROTECTED = [
  'İşyeri Açma ve Çalışma Ruhsatı', 'İşyeri Açma', 'Çalışma Ruhsatı', 'İşyeri Ruhsatı',
  'İtfaiye Uygunluk Raporu', 'İtfaiye', 'Baca Uygunluğu', 'Baca Uygunluk',
  'Gıda Sicil Belgesi', 'Gıda Sicil', 'Gıda İşletmeci Kaydı',
  'TAPDK Belgesi', 'TAPDK', 'Canlı Müzik İzni',
  'Göç İdaresi', 'İl Göç İdaresi', 'Vergi Dairesi', 'Vergi Numarası',
  'MERSİS', 'e-Devlet', 'e-ikamet', 'e-denklik', 'İstanbulkart', 'İstanbulKart',
  'YÖKSİS', 'Denklik', 'İkamet', 'Öğrenci Belgesi', 'Öğrenci Vizesi',
  'Ltd. Şti.', 'SGK', 'SMMM', 'İl MEB Müdürlüğü', 'MEB', 'YTB', 'KYK',
  'Ticaret Sicili', 'Ana Sözleşme', 'İmza Sirküleri', 'Faaliyet Ekle', 'Ön Başvuru',
  'Türkiye Bursları', 'Çalışma İzni', 'İcra takibi', 'Tapu',
];

const PROMPTS = [
  { agent: 'permit',  q: 'Stambulda kiçi restoran açmak üçin näme gerek?' },
  { agent: 'permit',  q: 'Kafe açmak näçe wagt alýar we bahasy näçe?' },
  { agent: 'permit',  q: 'Dükan açmak üçin haýsy resminamalar gerek?' },
  { agent: 'student', q: 'İkamet almak üçin näme etmeli?' },
  { agent: 'student', q: 'Uniwersitete bellige durmak üçin ädimler nähili?' },
  { agent: 'student', q: 'Talyp wizasyny nädip almaly?' },
  { agent: 'lawyer',  q: 'Türkiýede kompaniýa döretmek üçin näme gerek?' },
  { agent: 'lawyer',  q: 'Zähmet şertnamasy barada maglumat beriň.' },
];

// ---------------------------------------------------------------------------

async function ask(agent, query, sessionSuffix) {
  const res = await fetch(`${BASE}/agent/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      language: 'tk',
      context: { session_id: `guest-tkcheck-${sessionSuffix}` },
      assistant_type: agent,
      save_history: false,
      history: [],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${detail.slice(0, 200)}`);
  }

  const raw = await res.text();
  let text = '';
  for (const block of raw.split('\n\n')) {
    const lines = block.split('\n');
    const ev = lines.find((l) => l.startsWith('event:'));
    const da = lines.find((l) => l.startsWith('data:'));
    if (ev && ev.includes('delta') && da) {
      try { text += JSON.parse(da.slice(5).trim()).t || ''; } catch { /* skip */ }
    }
  }
  return text;
}

/** Blank out protected proper nouns so their Turkish words aren't miscounted. */
function maskProtected(text) {
  let masked = text;
  // Longest first, so "Gıda Sicil Belgesi" masks before bare "Gıda Sicil".
  for (const term of [...PROTECTED].sort((a, b) => b.length - a.length)) {
    masked = masked.split(term).join(' '.repeat(term.length));
  }
  return masked;
}

/**
 * Repetition-loop detection. Mirrors src/lib/response-quality.ts — kept as a
 * separate copy because this is a plain .mjs script with no TS build step.
 * This is the PRIMARY metric: a looping reply is far worse than a Turkish word.
 */
function degeneracy(text) {
  const w = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (w.length < 40) return { degenerate: false, uniqueRatio: 1, topPhrase: '', topPhraseCount: 0 };

  const counts = new Map();
  for (let n = 3; n <= 5; n++)
    for (let i = 0; i + n <= w.length; i++) {
      const p = w.slice(i, i + n).join(' ');
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }

  let topPhrase = '', topPhraseCount = 0;
  for (const [p, c] of counts) if (c > topPhraseCount) { topPhrase = p; topPhraseCount = c; }

  const uniqueRatio = new Set(w).size / w.length;
  return {
    degenerate: topPhraseCount >= 5 || uniqueRatio < 0.45,
    uniqueRatio, topPhrase, topPhraseCount,
  };
}

function score(text) {
  const masked = maskProtected(text);
  const lower = masked.toLowerCase();
  const hits = [];

  for (const marker of TURKISH_MARKERS) {
    // Word-boundary match that tolerates Turkish/Turkmen letters around it.
    const re = new RegExp(`(^|[^\\p{L}])${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'giu');
    const found = lower.match(re);
    if (found) hits.push({ marker, count: found.length });
  }

  for (const re of TURKISH_SUFFIX_PATTERNS) {
    const found = masked.match(re);
    if (found) for (const f of found) hits.push({ marker: f.toLowerCase(), count: 1 });
  }

  const words = masked.split(/\s+/).filter(Boolean).length;
  const hitCount = hits.reduce((n, h) => n + h.count, 0);
  return {
    words,
    hitCount,
    rate: words ? (hitCount / words) * 100 : 0,
    hits: hits.sort((a, b) => b.count - a.count),
  };
}

async function main() {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error('❌ DASHSCOPE_API_KEY not set in .env.local');
    process.exit(1);
  }

  try {
    const ping = await fetch(BASE, { method: 'GET' });
    if (!ping.ok) throw new Error(String(ping.status));
  } catch {
    console.error(`❌ No server responding at ${BASE}. Start it with: npm run dev`);
    process.exit(1);
  }

  if (!AS_JSON) console.log(`🔍 Turkmen contamination check against ${BASE}\n`);

  const results = [];
  let totalWords = 0;
  let totalHits = 0;
  let degenerateCount = 0;

  for (let i = 0; i < PROMPTS.length; i++) {
    const { agent, q } = PROMPTS[i];
    let text = '';
    let error = null;
    try {
      text = await ask(agent, q, i);
    } catch (e) {
      error = e.message;
    }

    if (error) {
      if (!AS_JSON) console.log(`  ✗ [${agent}] ${q}\n    ERROR: ${error}\n`);
      results.push({ agent, query: q, error });
      continue;
    }

    const s = score(text);
    const d = degeneracy(text);
    totalWords += s.words;
    totalHits += s.hitCount;
    if (d.degenerate) degenerateCount++;
    results.push({ agent, query: q, ...s, degeneracy: d, text });

    if (!AS_JSON) {
      const flag = d.degenerate ? '💥' : s.hitCount === 0 ? '✓' : s.rate < 3 ? '~' : '✗';
      console.log(`  ${flag} [${agent}] ${q}`);
      console.log(`      ${s.words} words · ${s.hitCount} leaks · ${s.rate.toFixed(1)}% · uniq ${(d.uniqueRatio * 100).toFixed(0)}%`);
      if (d.degenerate) {
        console.log(`      💥 DEGENERATE — "${d.topPhrase}" ×${d.topPhraseCount}`);
      }
      if (s.hits.length) {
        console.log(`      → ${s.hits.slice(0, 8).map((h) => `${h.marker}${h.count > 1 ? `×${h.count}` : ''}`).join(', ')}`);
      }
      console.log('');
    }
  }

  const overall = totalWords ? (totalHits / totalWords) * 100 : 0;
  const summary = {
    prompts: PROMPTS.length,
    totalWords,
    totalHits,
    contaminationRate: Number(overall.toFixed(2)),
    degenerateCount,
    degenerateRate: Number(((degenerateCount / PROMPTS.length) * 100).toFixed(1)),
  };

  if (AS_JSON) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log('─'.repeat(58));
    console.log(`  DEGENERATE REPLIES:  ${degenerateCount}/${PROMPTS.length}  (${summary.degenerateRate}%)   ← primary metric`);
    console.log(`  CONTAMINATION RATE:  ${overall.toFixed(2)}%  (${totalHits} leaks / ${totalWords} words)`);
    console.log('─'.repeat(58));
  }

  if (SAVE) {
    writeFileSync(SAVE, JSON.stringify({ summary, results }, null, 2), 'utf8');
    if (!AS_JSON) console.log(`\n💾 Saved to ${SAVE}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
