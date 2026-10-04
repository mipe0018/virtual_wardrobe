import { jobEnvFrom, JOB_SECRET_HEADER, secretMatches } from "../../src/lib/server/ai/background";
import { runCharacterJob, type CharacterJobPayload } from "../../src/lib/server/ai/jobs/character-job";

// Netlify Background Function (15 min limit). Thin wrapper: verify the shared secret,
// then hand the payload to the job module.
export default async (request: Request): Promise<Response> => {
  if (
    request.method !== "POST" ||
    !secretMatches(request.headers.get(JOB_SECRET_HEADER), process.env.BACKGROUND_JOB_SECRET)
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const env = jobEnvFrom(process.env);
  if (!env) {
    console.error("Background job environment is incomplete.");
    return new Response("Server configuration error", { status: 500 });
  }
  let payload: CharacterJobPayload;
  try {
    payload = (await request.json()) as CharacterJobPayload;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  await runCharacterJob(env, payload);
  return new Response(null, { status: 202 });
};