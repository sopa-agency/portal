"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export async function createCampaign(formData: FormData) {
  const rawName = (formData.get("name") as string | null)?.trim();
  const name = rawName || "Untitled campaign";

  const campaign = await prisma.campaign.create({
    data: {
      name,
      documents: { create: { name: "Brief", isMain: true, content: "" } },
    },
    select: { id: true },
  });

  revalidatePath("/campaign-creator");
  redirect(`/campaign-creator/${campaign.id}`);
}

export async function renameCampaign(id: string, name: string) {
  const next = name.trim() || "Untitled campaign";
  await prisma.campaign.update({ where: { id }, data: { name: next } });
  revalidatePath("/campaign-creator");
  revalidatePath(`/campaign-creator/${id}`);
}

export async function deleteCampaign(id: string) {
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaign-creator");
}

export async function createDocument(
  campaignId: string,
  name?: string,
): Promise<{ ok: boolean; documentId?: string; error?: string }> {
  try {
    const doc = await prisma.campaignDocument.create({
      data: {
        campaignId,
        name: name?.trim() || "Untitled document",
        content: "",
        isMain: false,
      },
      select: { id: true },
    });
    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true, documentId: doc.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteDocument(
  documentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: { campaignId: true, isMain: true },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.isMain) return { ok: false, error: "Cannot delete the main brief." };
    await prisma.campaignDocument.delete({ where: { id: documentId } });
    revalidatePath(`/campaign-creator/${doc.campaignId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateDocumentContent(documentId: string, content: string) {
  const doc = await prisma.campaignDocument.update({
    where: { id: documentId },
    data: { content },
    select: { campaignId: true },
  });
  revalidatePath(`/campaign-creator/${doc.campaignId}`);
}

export async function renameDocument(documentId: string, name: string) {
  const next = name.trim() || "Untitled";
  const doc = await prisma.campaignDocument.update({
    where: { id: documentId },
    data: { name: next },
    select: { campaignId: true },
  });
  revalidatePath(`/campaign-creator/${doc.campaignId}`);
}
