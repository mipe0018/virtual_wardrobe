import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type AuthenticatedRequest = {
  ok: true;
  client: SupabaseClient;
  user: User;
};

type AuthenticationFailure = {
  ok: false;
  status: 401 | 503;
  message: string;
};

export type AuthenticatedRequestResult =
  | AuthenticatedRequest
  | AuthenticationFailure;

export function createSupabaseServiceClient(): SupabaseClient {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Trusted Supabase server access is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export async function authenticateSupabaseRequest(
  request: Request
): Promise<AuthenticatedRequestResult> {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      status: 503,
      message: "Authentication is not configured.",
    };
  }

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      message: "A valid sign-in is required.",
    };
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data, error } = await client.auth.getUser(accessToken);

  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      message: "A valid sign-in is required.",
    };
  }

  return {
    ok: true,
    client,
    user: data.user,
  };
}
