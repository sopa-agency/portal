// Shared GitHub-label specs used by the Kanban card features. Labels live on
// the card's repo (issues/PRs only — draft cards can't carry labels). Colors are
// 6-hex WITHOUT the leading '#', the format the GitHub labels API expects.

export type LabelSpec = { name: string; color: string; description?: string };

/** Team/category tags — non-exclusive (a card can be more than one). */
export const CATEGORY_LABELS: LabelSpec[] = [
  { name: "mkt", color: "ec4899", description: "Marketing" },
  { name: "dev", color: "3b82f6", description: "Desenvolvimento" },
  { name: "op", color: "f59e0b", description: "Operacional" },
];

/** Test/QA workflow labels. */
export const TEST_NEEDS = "needs-test";
export const TEST_PASSED = "tested";
export const TEST_LABELS: LabelSpec[] = [
  { name: TEST_NEEDS, color: "fbca04", description: "Aguardando teste / QA" },
  { name: TEST_PASSED, color: "0e8a16", description: "Testado e aprovado" },
];

export const CATEGORY_NAMES = CATEGORY_LABELS.map((l) => l.name);
