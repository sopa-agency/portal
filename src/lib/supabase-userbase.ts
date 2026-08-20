import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_USERBASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_USERBASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const isValidUrl = (u?: string) => !!u && (u.startsWith("http://") || u.startsWith("https://"));

let cached: SupabaseClient | null = null;

export function getUserbaseClient(): SupabaseClient | null {
  if (cached) return cached;
  if (!isValidUrl(url) || !serviceKey) return null;
  cached = createClient(url!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
