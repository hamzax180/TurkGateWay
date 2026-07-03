
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../src/lib/schema';
import fs from 'fs';
import path from 'path';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("No DATABASE_URL found.");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  const RESPONSES_DIR = path.join(process.cwd(), 'src', 'lib', 'responses');

  // Load files
  const general = JSON.parse(fs.readFileSync(path.join(RESPONSES_DIR, 'general.json'), 'utf-8'));
  const permit = JSON.parse(fs.readFileSync(path.join(RESPONSES_DIR, 'permit.json'), 'utf-8'));
  const student = JSON.parse(fs.readFileSync(path.join(RESPONSES_DIR, 'student.json'), 'utf-8'));
  const lawyer = JSON.parse(fs.readFileSync(path.join(RESPONSES_DIR, 'lawyer.json'), 'utf-8'));

  const recordsToInsert: { assistant_type: string, intent_key: string, responses: string }[] = [];

  // Flatten general
  function flattenObj(obj: Record<string, any>, prefix = '') {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) {
        recordsToInsert.push({
          assistant_type: 'general',
          intent_key: key,
          responses: JSON.stringify(v)
        });
      } else if (v && typeof v === 'object') {
        flattenObj(v, key);
      }
    }
  }
  flattenObj(general);

  // Others are flat map of string[]
  for (const [k, v] of Object.entries(permit)) {
    recordsToInsert.push({ assistant_type: 'permit', intent_key: k, responses: JSON.stringify(v) });
  }
  for (const [k, v] of Object.entries(student)) {
    recordsToInsert.push({ assistant_type: 'student', intent_key: k, responses: JSON.stringify(v) });
  }
  for (const [k, v] of Object.entries(lawyer)) {
    recordsToInsert.push({ assistant_type: 'lawyer', intent_key: k, responses: JSON.stringify(v) });
  }

  console.log(`Inserting ${recordsToInsert.length} response templates...`);
  await db.insert(schema.responseTemplates).values(recordsToInsert);
  console.log('Migration complete!');
}

main().catch(console.error);
