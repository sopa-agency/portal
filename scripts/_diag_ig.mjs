import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.instagramPost.findMany({
  where: { projectSlug: "reelflip" },
  orderBy: { createdAt: "desc" },
  take: 8,
  select: { id: true, status: true, publishMode: true, scheduledFor: true, publishedAt: true, updatedAt: true, error: true, type: true, caption: true },
});
for (const r of rows) {
  console.log(JSON.stringify({
    id: r.id, status: r.status, publishMode: r.publishMode,
    scheduledFor: r.scheduledFor, publishedAt: r.publishedAt, updatedAt: r.updatedAt,
    type: r.type, error: r.error ? r.error.slice(0, 200) : null,
    caption: r.caption ? r.caption.slice(0, 60) : null,
  }));
}
await p.$disconnect();
