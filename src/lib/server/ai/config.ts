import { OPENAI_API_KEY } from "astro:env/server";
import { setOpenAiApiKey } from "./openai-images";

export const openAiApiKey = OPENAI_API_KEY || null;

// Astro-side only: hands the astro:env secret to the shared OpenAI client.
setOpenAiApiKey(openAiApiKey);
