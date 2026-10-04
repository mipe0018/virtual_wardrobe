import { OPENAI_API_KEY } from "astro:env/server";

export const openAiApiKey = OPENAI_API_KEY || null;
