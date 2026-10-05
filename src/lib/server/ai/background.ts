import { timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Shared by the Astro routes and the Netlify Background Functions. Must not import
// `astro:env` or use `import.meta.env`, because the functions are bundled separately.

export const JOB_SECRET_HEADER = "x-job-secret";

export type JobEnv = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  openaiKey: string;
};

export function jobEnvFrom(env: Record<string, string | undefined>): JobEnv | null {
  const supabaseUrl = env.PUBLIC_SUPABASE_URL;
  const anonKey = env.PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = env.OPENAI_API_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey || !openaiKey) return null;
  return { supabaseUrl, anonKey, serviceKey, openaiKey };
}

export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const clientOptions = {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
};

export function createJobClients(env: JobEnv, accessToken: string): {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
} {
  return {
    userClient: createClient(env.supabaseUrl, env.anonKey, {
      ...clientOptions,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    serviceClient: createClient(env.supabaseUrl, env.serviceKey, clientOptions),
  };
}

export async function jobUserIsValid(
  serviceClient: SupabaseClient,
  accessToken: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await serviceClient.auth.getUser(accessToken);
  return !error && data.user?.id === userId;
}

export type BackgroundFunctionName = "personal-model-background" | "process-clothing-background";

// Netlify answers a background function with 202 immediately and keeps running it.
export async function startBackgroundJob(
  origin: string,
  functionName: BackgroundFunctionName,
  payload: unknown,
  secret: string
): Promise<boolean> {
  try {
    const response = await fetch(new URL(`/.netlify/functions/${functionName}`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", [JOB_SECRET_HEADER]: secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`Background function ${functionName} rejected the job (HTTP ${response.status}).`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`Could not start background function ${functionName}.`, error);
    return false;
  }
}
