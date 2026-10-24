/* Sync settings. Leave both empty to keep documents on this device only.
   Both values are public by design (Supabase's publishable or "anon" key): row-level security in supabase/schema.sql is what keeps
   each person's documents private. Never put a secret or "service_role" key here. */
window.DOCUMENTS_CONFIG = {
  supabaseUrl: 'https://nypyuuqjfzuqxuusjknn.supabase.co',
  supabaseAnonKey: 'sb_publishable_Svt080gSztp1zgxuOibMLA_tG49rt42'
};
