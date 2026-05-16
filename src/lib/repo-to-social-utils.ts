export function parseRepoUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function repoUrlToLabel(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  return parts[parts.length - 1] || cleaned;
}

export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const match = url.trim().match(/github\.com[:/]([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#]|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
