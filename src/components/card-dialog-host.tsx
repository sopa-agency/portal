"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AggregatedItem, KanbanItem } from "@/lib/github-project";
import type { BountyDTO } from "@/app/actions/bounty";
import { listBounties } from "@/app/actions/bounty";
import { getProjectAssignees, type Assignee } from "@/app/actions/kanban";
import { taskKeyOf } from "@/components/bounty-panel";
import { CardDetailDialog } from "@/components/kanban-board";

/**
 * Opens the shared Kanban CardDetailDialog in place — anywhere a task is shown
 * (home "For you", a member's tasks on Team) — instead of routing to /kanban.
 * It carries the same cross-project mutation wiring as the aggregated board:
 * mutations hit the card's OWN project board via /api/kanban; assignees and the
 * bounty load lazily once the dialog is open.
 */
export function CardDialogHost({
  item,
  canManage = false,
  onClose,
}: {
  item: AggregatedItem;
  canManage?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [card, setCard] = useState<AggregatedItem>(item);
  const [team, setTeam] = useState<Assignee[] | null>(null);
  const [bounty, setBounty] = useState<BountyDTO | undefined>(undefined);

  useEffect(() => setCard(item), [item]);

  useEffect(() => {
    let live = true;
    setTeam(null);
    setBounty(undefined);
    getProjectAssignees(item.projectSlug).then((r) => { if (live) setTeam(r.ok ? r.assignees : []); });
    listBounties().then((r) => { if (live && r.ok) setBounty(r.bounties.find((b) => b.taskKey === taskKeyOf(item))); });
    return () => { live = false; };
  }, [item]);

  function patchCard(itemId: string, patch: Partial<KanbanItem>) {
    setCard((prev) => (prev.id === itemId ? { ...prev, ...patch } : prev));
  }

  // Every mutation targets the card's own project board (cross-project token).
  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/kanban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, projectId: card.projectId, targetProjectSlug: card.projectSlug }),
    });
    return res.json();
  }

  async function setAssignees(_item: KanbanItem, logins: string[]) {
    const optimistic = logins.map(
      (l) => card.assignees.find((a) => a.login.toLowerCase() === l.toLowerCase()) ?? { login: l, avatarUrl: `https://github.com/${l}.png?size=48` },
    );
    const prev = card.assignees;
    patchCard(card.id, { assignees: optimistic });
    const r = await post({ action: "setAssignees", contentId: card.contentId, itemType: card.type, logins, currentLogins: prev.map((a) => a.login) });
    if (!r.ok) patchCard(card.id, { assignees: prev });
  }

  return (
    <CardDetailDialog
      item={card}
      team={team ?? []}
      memberForLogin={() => null}
      projectSlug={card.projectSlug}
      canManage={canManage}
      bounty={bounty}
      onBountyChanged={() => router.refresh()}
      onSetAssignees={setAssignees}
      onMutate={post}
      onPatchItem={patchCard}
      onClose={onClose}
    />
  );
}
