import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { getDictionary } from "@/lib/i18n/server";
import { chatSession, listConversations } from "@/lib/chat-store";
import { AgentChat } from "@/components/agent-chat";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const project = await getActiveProject();
  if (!project.chat) notFound();

  const session = await chatSession();
  if (!session) notFound();

  const [dict, conversations] = await Promise.all([
    getDictionary(),
    listConversations(session),
  ]);

  return (
    <AgentChat
      t={dict.chat}
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
