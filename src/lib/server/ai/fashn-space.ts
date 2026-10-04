import { Buffer } from "node:buffer";

const SPACE_ORIGIN = "https://fashn-ai-fashn-vton-1-5.hf.space";
const MAX_ERROR_BODY_LENGTH = 1_000;
const MAX_RESULT_BODY_BYTES = 64 * 1024;

export type FashnCategory = "tops" | "bottoms" | "one-pieces";
export type FashnPhotoType = "model" | "flat-lay";

export class FashnSpaceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly providerStatus?: number,
    readonly providerEvent?: string,
    readonly providerError?: string
  ) {
    super(message);
    this.name = "FashnSpaceError";
  }
}

type GradioImageData = {
  path: string;
  orig_name: string;
  meta: { _type: "gradio.FileData" };
};

function parseCompletionEvent(
  stream: string,
  providerStatus: number
): unknown {
  for (const block of stream.split(/\r?\n\r?\n/).reverse()) {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");

    if (event === "error") {
      let providerError: string | undefined;
      if (data && data !== "null") {
        try {
          const parsed: unknown = JSON.parse(data);
          if (typeof parsed === "string") {
            providerError = parsed;
          } else if (parsed && typeof parsed === "object") {
            const detail = parsed as Record<string, unknown>;
            const message = detail.message ?? detail.error ?? detail.detail;
            if (typeof message === "string" && message.trim()) {
              providerError = message;
            }
          } else {
            providerError = data;
          }
        } catch {
          providerError = data;
        }
      }

      const message = providerError
        ? `FASHN generation failed: ${providerError.slice(0, MAX_ERROR_BODY_LENGTH)}`
        : `FASHN generation failed. Gradio returned an error event without details (HTTP ${providerStatus}).`;
      throw new FashnSpaceError(
        message,
        undefined,
        providerStatus,
        event,
        providerError
      );
    }

    if (event === "complete" && data) {
      try {
        return JSON.parse(data);
      } catch {
        throw new FashnSpaceError("FASHN returned an invalid completion response.");
      }
    }
  }

  throw new FashnSpaceError("FASHN did not return a completed result.");
}

function extractResultUrl(completion: unknown): URL {
  if (!Array.isArray(completion)) {
    throw new FashnSpaceError("FASHN returned an invalid result.");
  }

  const result = completion[0];
  if (!result || typeof result !== "object") {
    throw new FashnSpaceError("FASHN did not return a try-on image.");
  }

  const urlValue = (result as { url?: unknown }).url;
  if (typeof urlValue !== "string") {
    throw new FashnSpaceError("FASHN did not return a downloadable image URL.");
  }

  let resultUrl: URL;
  try {
    resultUrl = new URL(urlValue);
  } catch {
    throw new FashnSpaceError("FASHN returned an invalid result URL.");
  }

  if (
    resultUrl.protocol !== "https:" ||
    resultUrl.hostname !== "fashn-ai-fashn-vton-1-5.hf.space" ||
    resultUrl.username ||
    resultUrl.password
  ) {
    throw new FashnSpaceError("FASHN returned an untrusted result URL.");
  }

  return resultUrl;
}

async function fetchBeforeDeadline(
  url: URL,
  init: RequestInit,
  deadline: number,
  phase: string
): Promise<Response> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new FashnSpaceError("FASHN took too long to respond. Please try again.");
  }

  const signal = AbortSignal.timeout(remainingMs);
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (signal.aborted) {
      throw new FashnSpaceError("FASHN took too long to respond. Please try again.");
    }

    console.error(`FASHN ${phase} request failed.`, error);
    throw new FashnSpaceError("Could not contact the FASHN Space. Please try again.");
  }
}

export async function generateFashnTryOn(input: {
  personImageDataUrl: string;
  personMimeType: string;
  garmentImageDataUrl: string;
  garmentMimeType: string;
  category: FashnCategory;
  photoType: FashnPhotoType;
  deadline: number;
}): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const apiUrl = new URL("/gradio_api/call/try_on", SPACE_ORIGIN);
  const personPath = await uploadGradioImage(
    input.personImageDataUrl,
    input.personMimeType,
    "person-image",
    input.deadline
  );
  const garmentPath = await uploadGradioImage(
    input.garmentImageDataUrl,
    input.garmentMimeType,
    "garment-image",
    input.deadline
  );
  const personImage: GradioImageData = {
    path: personPath,
    orig_name: "person-image",
    meta: { _type: "gradio.FileData" },
  };
  const garmentImage: GradioImageData = {
    path: garmentPath,
    orig_name: "garment-image",
    meta: { _type: "gradio.FileData" },
  };

  const generationResponse = await fetchBeforeDeadline(
    apiUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          personImage,
          garmentImage,
          input.category,
          input.photoType,
          50,
          1.5,
          42,
          true,
        ],
      }),
    },
    input.deadline,
    "submission"
  );

  if (!generationResponse.ok) {
    const body = (await generationResponse.text()).slice(0, MAX_ERROR_BODY_LENGTH);
    console.error("FASHN submission was rejected.", {
      endpoint: apiUrl.origin + apiUrl.pathname,
      method: "POST",
      status: generationResponse.status,
      body,
    });

    if (generationResponse.status === 429 || generationResponse.status === 503) {
      throw new FashnSpaceError(
        "The FASHN Space is busy or rate-limited. Please try again later.",
        generationResponse.status
      );
    }

    throw new FashnSpaceError(
      `The FASHN Space rejected the request (HTTP ${generationResponse.status}).`,
      generationResponse.status
    );
  }

  let eventId: unknown;
  try {
    const response = (await generationResponse.json()) as { event_id?: unknown };
    eventId = response.event_id;
  } catch {
    throw new FashnSpaceError("FASHN returned an invalid queue response.");
  }

  if (typeof eventId !== "string" || !/^[\w-]+$/.test(eventId)) {
    throw new FashnSpaceError("FASHN did not return a valid queue event ID.");
  }

  const resultUrl = new URL(
    `/gradio_api/call/try_on/${encodeURIComponent(eventId)}`,
    SPACE_ORIGIN
  );
  const resultResponse = await fetchBeforeDeadline(
    resultUrl,
    { method: "GET", headers: { Accept: "text/event-stream" } },
    input.deadline,
    "status"
  );

  if (!resultResponse.ok) {
    const body = (await resultResponse.text()).slice(0, MAX_ERROR_BODY_LENGTH);
    console.error("FASHN status request failed.", {
      endpoint: resultUrl.origin + resultUrl.pathname,
      method: "GET",
      status: resultResponse.status,
      body,
    });

    if (resultResponse.status === 429 || resultResponse.status === 503) {
      throw new FashnSpaceError(
        "The FASHN Space is busy or rate-limited. Please try again later.",
        resultResponse.status
      );
    }

    throw new FashnSpaceError(
      `Could not check the FASHN generation result (HTTP ${resultResponse.status}).`,
      resultResponse.status
    );
  }

  const resultText = await resultResponse.text();
  if (Buffer.byteLength(resultText, "utf8") > MAX_RESULT_BODY_BYTES) {
    throw new FashnSpaceError("FASHN returned an unexpectedly large status response.");
  }

  const resultUrlFromEvent = extractResultUrl(
    parseCompletionEvent(resultText, resultResponse.status)
  );
  const imageResponse = await fetchBeforeDeadline(
    resultUrlFromEvent,
    { method: "GET" },
    input.deadline,
    "image download"
  );

  if (!imageResponse.ok) {
    const body = (await imageResponse.text()).slice(0, MAX_ERROR_BODY_LENGTH);
    console.error("FASHN result image download failed.", {
      endpoint: resultUrlFromEvent.origin + resultUrlFromEvent.pathname,
      method: "GET",
      status: imageResponse.status,
      body,
    });
    throw new FashnSpaceError(
      `Could not download the FASHN result (HTTP ${imageResponse.status}).`,
      imageResponse.status
    );
  }

  const mimeType = imageResponse.headers
    .get("content-type")
    ?.split(";")[0]
    .toLowerCase();
  const bytes = await imageResponse.arrayBuffer();
  if (
    !mimeType ||
    !["image/jpeg", "image/png", "image/webp"].includes(mimeType) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > 20 * 1024 * 1024
  ) {
    throw new FashnSpaceError("The FASHN result image format or size is not supported.");
  }

  return { bytes, mimeType };
}

async function uploadGradioImage(
  dataUrl: string,
  mimeType: string,
  fileName: string,
  deadline: number
): Promise<string> {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match || match[1] !== mimeType) {
    throw new FashnSpaceError("Could not prepare an image for Gradio upload.");
  }

  const imageBytes = Buffer.from(match[2], "base64");
  if (imageBytes.length === 0) {
    throw new FashnSpaceError("The image for Gradio upload is empty.");
  }

  const formData = new FormData();
  formData.append(
    "files",
    new Blob([new Uint8Array(imageBytes)], { type: mimeType }),
    fileName
  );

  const uploadUrl = new URL("/gradio_api/upload", SPACE_ORIGIN);
  const response = await fetchBeforeDeadline(
    uploadUrl,
    { method: "POST", body: formData },
    deadline,
    "image upload"
  );

  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_ERROR_BODY_LENGTH);
    console.error("Gradio image upload failed.", {
      endpoint: uploadUrl.origin + uploadUrl.pathname,
      method: "POST",
      status: response.status,
      body,
    });
    throw new FashnSpaceError(
      `Gradio image upload failed (HTTP ${response.status}).`,
      response.status
    );
  }

  let uploadedPaths: unknown;
  try {
    uploadedPaths = await response.json();
  } catch {
    throw new FashnSpaceError("Gradio returned an invalid image upload response.");
  }

  if (
    !Array.isArray(uploadedPaths) ||
    typeof uploadedPaths[0] !== "string" ||
    uploadedPaths[0].length === 0
  ) {
    throw new FashnSpaceError("Gradio did not return an uploaded image path.");
  }

  return uploadedPaths[0];
}
