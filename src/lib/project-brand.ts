import type { ProjectConfig } from "@/projects/types";
import type { TweetBrand } from "@/components/tweet-batch-dialog";

/**
 * The active project's identity for X-style post previews: logo, display
 * name, and X handle (falling back to the Hive account).
 */
export function tweetBrand(project: ProjectConfig): TweetBrand {
  const x = project.socials.find((s) => {
    const p = s.platform.toLowerCase();
    return p === "x" || p.includes("twitter");
  });
  const rawHandle = x?.handle ?? project.hive.account;
  return {
    name: project.name,
    handle: rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`,
    avatarUrl: project.theme.logo,
  };
}
