import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { chatSession, listConversations } from "@/lib/chat-store";
import { AgentChat } from "@/components/agent-chat";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const project = await getActiveProject();
  if (!project.chat) notFound();

  const session = await chatSession();
  if (!session) notFound();

  const conversations = await listConversations(session);

  return (
    <AgentChat
      agentName={project.agent.displayName}
      agentEmoji={project.agent.emoji ?? "\u{1F916}"}
      initialConversations={conversations.map((c) => ({
        id: c.id,
        title: c.title,
        pinned: c.pinned,
        updatedAt: c.updatedAt.toISOString(),
      }))}
    />
  );
}
