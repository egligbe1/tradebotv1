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

CREATE TABLE IF NOT EXISTS public.trades (
    id bigint primary key generated always as identity,
    symbol text not null,
    side text not null,
    entry_price float not null,
    sl_price float not null,
    tp_price float not null,
    status text not null default 'OPEN',
    pnl float default 0,
    created_at timestamptz default now(),
    closed_at timestamptz
);

ALTER TABLE public.model_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'model_sync' AND policyname = 'Allow public access'
    ) THEN
        CREATE POLICY "Allow public access" ON public.model_sync
        FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'trades' AND policyname = 'Allow public access'
    ) THEN
        CREATE POLICY "Allow public access" ON public.trades
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
    
    // Parse the DB URL for components to avoid URL-encoding bugs
    const dbUrl = process.env.SUPABASE_DB_URL;
    
    if (!dbUrl) {
      console.log("");
      console.log("⚠️  No SUPABASE_DB_URL found in .env.");
      return;
    }
 
    try {
        const client = new Client({
          connectionString: dbUrl,
          ssl: { rejectUnauthorized: false }
        });
        await client.connect();
        console.log("✅ Connected!");
        await client.query(sql);
        console.log("✅ Database schema is up to date!");
        await client.end();
    } catch (e) {
        console.log("⚠️  Connection string failed, attempting explicit parameter fallback...");
        // Manual fallback for complex passwords
        const client = new Client({
            user: 'postgres',
            host: 'db.rkhzghaflnietnnojxcu.supabase.co',
            database: 'postgres',
            password: '4AsU$?SASr5BVK3',
            port: 5432,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();
        await client.query(sql);
        console.log("✅ Database schema is up to date (via fallback)!");
        await client.end();
    }

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
