import { getActiveProject } from "@/projects";
import { BrainExplorer } from "@/components/brain-explorer";

// Brain explorer for the active project's pinned agent. The agent is resolved
// here (and again in the API) from the active project — never from the client.
export default async function BrainPage() {
  const project = await getActiveProject();
  return <BrainExplorer agentName={project.agent.displayName} />;
}
