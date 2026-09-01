import { PageHeader } from "@/components/page-header";
import { SplitVote } from "@/components/split-vote";

export const dynamic = "force-dynamic";

export default function VotacaoPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="SOPA"
        title="Votação do split"
        description="Depois da reunião de segunda, cada um distribui 100 pontos entre os outros. O resultado vira a proporção do split."
      />
      <SplitVote />
    </div>
  );
}
