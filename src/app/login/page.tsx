import { Suspense } from "react";
import { getActiveProject } from "@/projects";
import { LoginForm } from "@/components/login-form";
import { githubOAuthCreds } from "@/lib/oauth-github";

// Server component: resolve the active project (from the subdomain, via the
// x-portal-project header set in proxy.ts) and brand the login screen for it.
export default async function LoginPage() {
  const project = await getActiveProject();
  const githubEnabled = !!githubOAuthCreds(project.agent.gatewayEnvPrefix);
  return (
    <Suspense>
      <LoginForm projectName={project.name} logo={project.theme.logo} githubEnabled={githubEnabled} />
    </Suspense>
  );
}
