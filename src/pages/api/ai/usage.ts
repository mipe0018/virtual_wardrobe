import type { APIRoute } from "astro";
import { authenticateSupabaseRequest } from "../../../lib/server/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.message },
      { status: authentication.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { data, error } = await authentication.client.rpc("get_ai_generation_usage");
  if (error) {
    console.error("Could not load AI generation usage.", error);
    return Response.json(
      { error: "Could not load generation limits. Apply the DRESSED AI migration first." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    { usage: data ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
};
