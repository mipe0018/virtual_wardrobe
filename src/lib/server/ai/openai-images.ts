import { Buffer } from "node:buffer";
import { openAiApiKey } from "./config";

const MODERATION_URL = "https://api.openai.com/v1/moderations";
const IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";
const MODERATION_MODEL = "omni-moderation-latest";
const IMAGE_MODEL = "gpt-image-2.5-sunburst";
const MAX_RESULT_BYTES = 20 * 1024 * 1024;

export type OpenAIImage = {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
};

export class OpenAIImageError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "OpenAIImageError";
  }
}

function getApiKey(): string {
  if (!openAiApiKey) {
    throw new OpenAIImageError("OpenAI image generation is not configured on the server.", 503);
  }
  return openAiApiKey;
}

async function providerError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `OpenAI returned HTTP ${response.status}.`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") {
      return parsed.error.message.slice(0, 800);
    }
  } catch {
    return text.slice(0, 800);
  }
  return text.slice(0, 800);
}

async function requestOpenAI(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new OpenAIImageError("OpenAI did not respond in time. Please try again.", 504);
    }
    const reason = error instanceof Error ? error.message : "network error";
    throw new OpenAIImageError(`Could not contact OpenAI: ${reason}`);
  }

  if (!response.ok) {
    const message = await providerError(response);
    const status = response.status === 429 ? 429 : response.status;
    throw new OpenAIImageError(
      response.status === 429
        ? `OpenAI rate limit or account quota reached: ${message}`
        : `OpenAI returned HTTP ${response.status}: ${message}`,
      status
    );
  }
  return response;
}

export function imageDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function moderateImage(dataUrl: string): Promise<void> {
  const response = await requestOpenAI(MODERATION_URL, {
    model: MODERATION_MODEL,
    input: [{ type: "image_url", image_url: { url: dataUrl } }],
  }, 8_000);

  const body = (await response.json()) as {
    results?: Array<{
      flagged?: unknown;
      categories?: Record<string, unknown>;
      category_scores?: Record<string, unknown>;
    }>;
  };
  const result = body.results?.[0];
  if (!result) {
    throw new OpenAIImageError("OpenAI moderation returned no result.");
  }

  const categories = result.categories ?? {};
  const scores = result.category_scores ?? {};
  const unsafeCategory =
    categories["sexual/minors"] === true ||
    categories["violence/graphic"] === true ||
    categories["self-harm"] === true ||
    categories["self-harm/intent"] === true ||
    categories["self-harm/instructions"] === true;
  const highRiskScore = Object.entries(scores).some(([category, value]) => {
    if (typeof value !== "number") return false;
    if (category === "sexual") return value >= 0.8;
    if (category === "violence") return value >= 0.8;
    return false;
  });

  if (unsafeCategory || highRiskScore || (result.flagged === true && !categories["sexual"])) {
    throw new OpenAIImageError(
      "This image could not be accepted. Please use a non-explicit, non-violent image.",
      422
    );
  }
}

export async function editImage(input: {
  images: string[];
  prompt: string;
  size?: "1024x1024" | "1024x1536";
  background?: "opaque" | "transparent";
}): Promise<OpenAIImage> {
  const response = await requestOpenAI(IMAGE_EDIT_URL, {
    model: IMAGE_MODEL,
    images: input.images.map((image_url) => ({ image_url })),
    prompt: input.prompt,
    size: input.size ?? "1024x1024",
    quality: "high",
    output_format: "png",
    background: input.background ?? "opaque",
    n: 1,
  }, 45_000);

  const body = (await response.json()) as {
    data?: Array<{ b64_json?: unknown }>;
  };
  const encoded = body.data?.[0]?.b64_json;
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new OpenAIImageError("OpenAI did not return a generated image.");
  }

  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_RESULT_BYTES ||
    bytes.toString("base64") !== encoded
  ) {
    throw new OpenAIImageError("The generated image format or size is not supported.");
  }
  return { bytes, mimeType: "image/png" };
}
