export type UsageEntry = {
  generation_type: "character" | "clothing" | "tryon";
  used_count: number;
  free_limit: number;
  in_progress: boolean;
};

export async function renderGenerationUsage(
  element: HTMLElement,
  accessToken: string
): Promise<UsageEntry[] | null> {
  const response = await fetch("/api/ai/usage", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const body = (await response.json()) as {
    error?: string;
    usage?: UsageEntry[];
  };
  if (!response.ok || !Array.isArray(body.usage)) {
    element.textContent = body.error ?? "GENERATION LIMITS COULD NOT BE LOADED.";
    return null;
  }
  element.replaceChildren();
  const labels: Record<UsageEntry["generation_type"], string> = {
    character: "CHARACTER",
    clothing: "CLOTHING",
    tryon: "OUTFIT",
  };
  for (const entry of body.usage) {
    const line = document.createElement("span");
    line.textContent =
      `${labels[entry.generation_type]}: ${entry.used_count} / ${entry.free_limit} used` +
      (entry.in_progress ? " — IN PROGRESS" : "");
    element.appendChild(line);
  }
  return body.usage;
}

// Polls /api/ai/usage until the server reports the generation as no longer in progress.
// Used after a background generation was accepted with HTTP 202.
export async function waitForGenerationToFinish(
  accessToken: string,
  type: UsageEntry["generation_type"],
  options: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<void> {
  const intervalMs = options.intervalMs ?? 4000;
  const deadline = Date.now() + (options.timeoutMs ?? 16 * 60 * 1000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const response = await fetch("/api/ai/usage", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { usage?: UsageEntry[] };
      const entry = body.usage?.find((row) => row.generation_type === type);
      if (entry && !entry.in_progress) return;
    } catch {
      // Transient network error: keep polling.
    }
  }
  throw new Error("The generation is taking too long. Please check again in a moment.");
}
