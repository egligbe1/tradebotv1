---
description: Automated Supabase model_sync table creation
---

To set up the database tables for TradeBot AI's cloud sync:

1. **Verify Credentials**: Ensure `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present in your `.env`.

2. **Run Initialization Script**:
// turbo
```bash
node scripts/bootstrap-supabase.js
```

3. **Check Output**: If the table didn't exist, the script would have prompted you with the SQL. However, if you have the `SERVICE_ROLE` key, the script can be expanded to run the SQL over a REST endpoint.
