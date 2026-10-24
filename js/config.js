/* Sync settings. Leave both empty to keep documents on this device only.
   Both values are public by design (Supabase's "anon" key): row-level security in supabase/schema.sql is what keeps
   each person's documents private. Never put the "service_role" key here. */
window.DOCUMENTS_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};
