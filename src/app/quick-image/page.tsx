import { Suspense } from "react";
import { QuickImage } from "@/components/quick-image";

export const dynamic = "force-dynamic";

export default function QuickImagePage() {
  return (
    <Suspense fallback={null}>
      <QuickImage />
    </Suspense>
  );
}
