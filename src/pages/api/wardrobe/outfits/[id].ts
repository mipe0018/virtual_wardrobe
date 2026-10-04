import type { APIRoute } from "astro";
import { authenticateSupabaseRequest } from "../../../../lib/server/supabase";

export const prerender = false;

export const DELETE: APIRoute = async ({ params, request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.message },
      { status: authentication.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  const { client, user } = authentication;
  const outfitId = params.id;
  if (
    !outfitId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outfitId)
  ) {
    return Response.json({ error: "A valid saved outfit ID is required." }, { status: 400 });
  }

  const { data, error } = await client
    .from("saved_dressed_outfits")
    .delete()
    .eq("user_id", user.id)
    .eq("id", outfitId)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error("Could not delete the saved DRESSED outfit.", error);
    return Response.json({ error: "Could not remove this saved outfit." }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "This saved outfit was not found." }, { status: 404 });
  }

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};
