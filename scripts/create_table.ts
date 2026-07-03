
import { neon } from '@neondatabase/serverless';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("No DATABASE_URL found.");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log("Creating response_templates table if it doesn't exist...");

  await sql`
    CREATE TABLE IF NOT EXISTS "response_templates" (
      "id" serial PRIMARY KEY NOT NULL,
      "assistant_type" varchar(20) NOT NULL,
      "intent_key" text NOT NULL,
      "responses" text NOT NULL,
      "updated_at" timestamp DEFAULT now()
    );
  `;

  console.log("Table created successfully!");
}

main().catch(console.error);
