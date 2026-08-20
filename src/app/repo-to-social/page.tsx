import { redirect } from "next/navigation";

// Repo to Social merged into Post Suggestions (the "Repo to Social" tab).
// Old links and bookmarks land on the right tab.
export default function RepoToSocialRedirect() {
  redirect("/marketing-suggestions?tab=repo");
}
