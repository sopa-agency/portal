"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import {
  resolveGitHubToken,
  ensureRepoLabels,
  setItemLabels,
  setItemStatus,
  addItemComment,
} from "@/lib/github-project";
import { TEST_NEEDS, TEST_PASSED, TEST_LABELS } from "@/lib/kanban-labels";
import { sendTeamMessage } from "@/app/actions/team";

type CardType = "issue" | "pr" | "draft";

/**
 * Request testing of a card "in review": tags it `needs-test`, drops a comment
 * for the audit trail, and pings every selected tester on their best channel.
 * Labels/comments only land on real issues/PRs (drafts can't carry labels) but
 * the tester pings always go out.
 */
export async function requestCardTest(input: {
  contentId: string | null;
  type: CardType;
  repo?: string | null; // "owner/name"
  title: string;
  cardUrl?: string; // shareable portal link (?open=id)
  prUrl?: string | null; // GitHub URL when it's a PR
  whatToTest: string;
  testers: string[]; // Hive usernames
}): Promise<
  | { ok: true; delivered: string[]; failed: string[]; labeled: boolean }
  | { ok: false; error: string }
> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };
    const token = resolveGitHubToken(project);
    if (!token) return { ok: false, error: "GITHUB_TOKEN not set" };

    const testers = [...new Set((input.testers ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean))];
    if (testers.length === 0) return { ok: false, error: "Selecione ao menos um testador." };
    const whatToTest = (input.whatToTest ?? "").trim().slice(0, 2000);
    const [owner, name] = (input.repo ?? "").split("/");
    const onRealCard = input.type !== "draft" && !!input.contentId && !!owner && !!name;

    // 1) needs-test label (real cards only) — and clear a stale `tested`.
    let labeled = false;
    if (onRealCard) {
      const meta = await ensureRepoLabels({ token, owner, name, wanted: TEST_LABELS });
      if (meta.ok) {
        const needs = meta.labels.find((l) => l.name.toLowerCase() === TEST_NEEDS);
        const passed = meta.labels.find((l) => l.name.toLowerCase() === TEST_PASSED);
        if (needs) {
          const r = await setItemLabels({
            token,
            contentId: input.contentId!,
            addIds: [needs.id],
            removeIds: passed ? [passed.id] : [],
          });
          labeled = r.ok;
        }
      }
    }

    // 2) audit-trail comment on the card.
    if (onRealCard) {
      const mentions = testers.map((t) => `@${t}`).join(" ");
      const body = [
        `🧪 **Teste solicitado** por @${session.username} → ${mentions}`,
        input.cardUrl ? `\n\n${input.cardUrl}` : "",
        whatToTest ? `\n\n**O que testar:**\n${whatToTest}` : "",
      ].join("");
      await addItemComment({ token, contentId: input.contentId!, body });
    }

    // 3) ping each tester on their best channel.
    const link = input.prUrl || input.cardUrl || "";
    const dm = [
      `🧪 @${session.username} pediu pra você testar um card:`,
      `"${input.title}"`,
      link,
      whatToTest ? `\nO que testar:\n${whatToTest}` : "",
      `\nQuando terminar, abra o card e marque ✅ Aprovar ou ↩️ Reprovar.`,
    ]
      .filter(Boolean)
      .join("\n");

    const delivered: string[] = [];
    const failed: string[] = [];
    for (const t of testers) {
      const r = await sendTeamMessage({ username: t, message: dm });
      if (r.ok) delivered.push(t);
      else failed.push(t);
    }

    return { ok: true, delivered, failed, labeled };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao solicitar teste." };
  }
}

/**
 * Close a test request: pass → move to Done + swap `needs-test`→`tested`;
 * fail → move to In Progress + drop `needs-test`. Always leaves a comment. The
 * target status optionId is resolved client-side from the board columns.
 */
export async function resolveCardTest(input: {
  itemId: string;
  contentId: string | null;
  type: CardType;
  repo?: string | null;
  projectId?: string | null;
  statusFieldId?: string | null;
  targetOptionId?: string | null;
  verdict: "pass" | "fail";
  note?: string;
  title: string;
}): Promise<{ ok: true; moved: boolean } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };
    const token = resolveGitHubToken(project);
    if (!token) return { ok: false, error: "GITHUB_TOKEN not set" };

    const note = (input.note ?? "").trim().slice(0, 2000);

    // 1) move status (when the client resolved a target column).
    let moved = false;
    if (input.projectId && input.statusFieldId && input.targetOptionId) {
      const r = await setItemStatus({
        token,
        projectId: input.projectId,
        itemId: input.itemId,
        fieldId: input.statusFieldId,
        optionId: input.targetOptionId,
      });
      moved = r.ok;
    }

    // 2) labels (real cards only).
    const [owner, name] = (input.repo ?? "").split("/");
    if (input.type !== "draft" && input.contentId && owner && name) {
      const meta = await ensureRepoLabels({ token, owner, name, wanted: TEST_LABELS });
      if (meta.ok) {
        const needs = meta.labels.find((l) => l.name.toLowerCase() === TEST_NEEDS);
        const passed = meta.labels.find((l) => l.name.toLowerCase() === TEST_PASSED);
        await setItemLabels({
          token,
          contentId: input.contentId,
          addIds: input.verdict === "pass" && passed ? [passed.id] : [],
          removeIds: needs ? [needs.id] : [],
        });
      }
    }

    // 3) comment.
    if (input.contentId && input.type !== "draft") {
      const body =
        input.verdict === "pass"
          ? `✅ **Testado e aprovado** por @${session.username}${note ? `\n\n${note}` : ""}`
          : `↩️ **Reprovado no teste** por @${session.username}${note ? `:\n\n${note}` : "."}`;
      await addItemComment({ token, contentId: input.contentId, body });
    }

    return { ok: true, moved };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao resolver teste." };
  }
}
