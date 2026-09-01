import type { Metadata } from "next";
import { AppIdeaForm } from "@/components/app-idea-form";

// Página PÚBLICA e compartilhável: o link vai pra quem não tem (nem vai ter)
// conta no portal. O proxy carimba x-public-page e tira o cookie, então esta
// rota renderiza sem a moldura do portal — e renderiza igual pra todo mundo,
// logado ou não, que é o que faz o link ser conferível antes de mandar.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Me conta sua ideia de app",
  description: "Descreva o app que você quer que exista. Leva uns cinco minutos.",
};

export default function AppIdeaPage() {
  return <AppIdeaForm />;
}
