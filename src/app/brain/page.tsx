import { redirect } from "next/navigation";

// Brain moved into Settings as a tab. Keep the old route working (bookmarks,
// the floating chat's "open Brain" link) by redirecting to the tab.
export default function BrainPage() {
  redirect("/settings?tab=brain");
}
