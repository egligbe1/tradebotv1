/**
 * TradeBot AI - Database Bootstrap Script
 * Automatically creates the 'model_sync' table via the Supabase REST API.
 * 
 * Usage: node scripts/bootstrap-supabase.js
 */

import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const sql = `
CREATE TABLE IF NOT EXISTS public.model_sync (
    id bigint primary key generated always as identity,
    symbol text not null,
    model_name text not null,
    weights jsonb not null,
    updated_at timestamptz default now(),
    unique(symbol, model_name)
);

CREATE TABLE IF NOT EXISTS public.training_status (
    id bigint primary key generated always as identity,
    workflow_id text not null unique,
    current_asset text,
    is_training boolean default false,
    message text,
    progress_percent float,
    updated_at timestamptz default now()
);

ALTER TABLE public.model_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_status ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'model_sync' AND policyname = 'Allow public access'
    ) THEN
        CREATE POLICY "Allow public access" ON public.model_sync
        FOR ALL USING (true);
    END IF;
END $$;
`;

async function runMigration() {
  console.log("🚀 Executing migration via Supabase REST API...");

  try {
    // Use the PostgREST RPC endpoint to execute raw SQL via a custom function,
    // OR use the Supabase Management API sql endpoint
    const response = await fetch(supabaseUrl + "/rest/v1/rpc/", {
      method: "POST",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": "Bearer " + serviceRoleKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    // If the RPC approach doesn't work, try creating via the SQL query endpoint
    // Supabase exposes /pg/query for service_role authenticated requests
    const sqlResponse = await fetch(supabaseUrl + "/rest/v1/", {
      method: "GET",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": "Bearer " + serviceRoleKey,
      }
    });

    if (sqlResponse.ok) {
      console.log("✅ Supabase REST API is reachable.");
    }

    // Unfortunately PostgREST doesn't support DDL (CREATE TABLE) directly.
    // The best automated approach is to use Supabase CLI or the SQL Editor.
    // Let's try the pg library with the pooler endpoint instead.
    
    const pg = await import('pg');
    const { Client } = pg.default;
    
    // Try using the Supabase Pooler (which IS reachable via the main hostname)
    let projectRef = '';
    try {
      const urlObj = new URL(supabaseUrl);
      projectRef = urlObj.hostname.split('.')[0];
    } catch (e) {
      projectRef = supabaseUrl.replace('https://', '').split('.')[0];
    }
    
    // The pooler runs on the same hostname as the API but on port 6543
    const poolerHost = "aws-0-us-east-1.pooler.supabase.com";
    const dbPassword = process.env.SUPABASE_DB_PASSWORD;
    
    if (!dbPassword) {
      console.log("");
      console.log("⚠️  Direct Postgres connection isn't available for this project.");
      console.log("   Please run the following SQL in your Supabase Dashboard SQL Editor:");
      console.log("   (Dashboard -> SQL Editor -> New Query -> Paste & Run)");
      console.log("────────────────────────────────────────────────────");
      console.log(sql);
      console.log("────────────────────────────────────────────────────");
      console.log("✅ Once done, your cloud sync will be fully operational!");
      return;
    }

    // Try connecting via pooler  
    const client = new Client({
      host: poolerHost,
      port: 6543,
      database: 'postgres',
      user: "postgres." + projectRef,
      password: dbPassword,
      ssl: { rejectUnauthorized: false }
    });

    console.log("🔄 Trying Supabase Connection Pooler...");
    await client.connect();
    console.log("✅ Connected via pooler!");
    
    console.log("🏗  Creating model_sync table...");
    await client.query(sql);
    console.log("✅ Table 'model_sync' is ready! Cloud sync is now fully operational.");
    
    await client.end();

  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    
    if (err.message.includes('ENOTFOUND') || err.message.includes('timeout')) {
      console.log("");
      console.log("⚠️  Could not connect to the database directly.");
      console.log("   Please run the following SQL in your Supabase Dashboard SQL Editor:");
      console.log("   (Dashboard -> SQL Editor -> New Query -> Paste & Run)");
      console.log("────────────────────────────────────────────────────");
      console.log(sql);
      console.log("────────────────────────────────────────────────────");
    }
  }
}

runMigration();
