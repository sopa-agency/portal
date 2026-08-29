import { NextResponse } from "next/server";
import { chatSession, listConversations, createConversation } from "@/lib/chat-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const s = await chatSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  return NextResponse.json({ ok: true, conversations: await listConversations(s) });
}

export async function POST(): Promise<Response> {
  const s = await chatSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const conversation = await createConversation(s);
  return NextResponse.json({ ok: true, conversation });
}
