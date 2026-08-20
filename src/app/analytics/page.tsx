import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { SetupGuide, Code, CodeBlock } from "@/components/setup-guide";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const project = await getActiveProject();

  if (!project.analytics) {
    const prefix = project.agent.gatewayEnvPrefix;
    return (
      <div className="space-y-8">
        <PageHeader
          title="Analytics"
          description="GA4 traffic and Search Console performance data."
        />
        <SetupGuide
          feature="Analytics"
          intro={`Para mostrar tráfego e busca do site do ${project.name}, o portal precisa de uma propriedade GA4 (e opcionalmente Search Console) acessível por uma service account.`}
          steps={[
            {
              title: "Tenha uma propriedade GA4 do site",
              body: (
                <>
                  Em analytics.google.com, crie (ou localize) a propriedade do site e anote o{" "}
                  <Code>Property ID</Code> numérico (Admin → Property Settings). Se o site estiver
                  no Search Console, anote também o formato da propriedade (ex.:{" "}
                  <Code>sc-domain:seusite.com</Code>).
                </>
              ),
            },
            {
              title: "Crie uma service account e dê acesso",
              body: (
                <>
                  No Google Cloud Console → IAM → Service Accounts, crie uma conta e baixe a chave
                  JSON. Adicione o email dela (<Code>…@….iam.gserviceaccount.com</Code>) como{" "}
                  <strong>Viewer</strong> na propriedade GA4 (Admin → Property Access Management) e
                  como usuário restrito no Search Console.
                </>
              ),
            },
            {
              title: "Configure a credencial no ambiente",
              body: (
                <>
                  Salve o JSON inteiro (uma linha) como{" "}
                  <Code>{prefix}_GOOGLE_SERVICE_ACCOUNT_JSON</Code> no <Code>.env.local</Code> e no
                  Vercel (production).
                </>
              ),
            },
            {
              title: "Adicione o bloco analytics no config do projeto e faça deploy",
              body: (
                <CodeBlock>{`// src/projects/${project.slug}.ts
analytics: {
  ga4PropertyId: "123456789",
  gscSiteUrl: "sc-domain:seusite.com",
},`}</CodeBlock>
              ),
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description="GA4 traffic and Search Console performance data."
      />
      <AnalyticsDashboard agentName={project.agent.displayName} />
    </div>
  );
}
