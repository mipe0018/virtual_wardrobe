import { openAiApiKey } from "./config";
import {
  jobEnvFrom,
  startBackgroundJob,
  type BackgroundFunctionName,
  type JobEnv,
} from "./background";

// Astro-route side only (uses import.meta.env and astro:env via ./config).
// Production: starts the Netlify Background Function and returns once it accepted the job.
// Development (`astro dev` has no Netlify functions): runs the same job in-process,
// without awaiting it, so the polling flow behaves like production.
export async function launchBackgroundJob<T>(
  request: Request,
  functionName: BackgroundFunctionName,
  payload: T,
  runInline: (env: JobEnv, payload: T) => Promise<void>
): Promise<boolean> {
  if (import.meta.env.DEV) {
    const env = jobEnvFrom({
      PUBLIC_SUPABASE_URL: import.meta.env.PUBLIC_SUPABASE_URL,
      PUBLIC_SUPABASE_ANON_KEY: import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
      OPENAI_API_KEY: openAiApiKey ?? undefined,
    });
    if (!env) return false;
    void runInline(env, payload).catch((error) =>
      console.error("Inline background job crashed.", error)
    );
    return true;
  }

  const secret = import.meta.env.BACKGROUND_JOB_SECRET;
  if (!secret) {
    console.error("BACKGROUND_JOB_SECRET is not configured.");
    return false;
  }
  return startBackgroundJob(new URL(request.url).origin, functionName, payload, secret);
}
