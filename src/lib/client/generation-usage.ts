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
