// Cliente de Supabase para el SERVIDOR (usa la clave service_role).
// Nunca exponer esta clave en el frontend.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('[config] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.');
}

export const db = createClient(url ?? '', key ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
