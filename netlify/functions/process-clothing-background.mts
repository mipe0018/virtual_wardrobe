import { jobEnvFrom, JOB_SECRET_HEADER, secretMatches } from "../../src/lib/server/ai/background";
import { runClothingJob, type ClothingJobPayload } from "../../src/lib/server/ai/jobs/clothing-job";

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
  let payload: ClothingJobPayload;
  try {
    payload = (await request.json()) as ClothingJobPayload;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  await runClothingJob(env, payload);
  return new Response(null, { status: 202 });
};