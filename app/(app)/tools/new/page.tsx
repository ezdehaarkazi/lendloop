"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { ToolForm } from "@/components/tool-form";
import { Card, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { useAction } from "@/lib/useAction";

export default function NewToolPage() {
  const router = useRouter();
  const [create, pending] = useAction(useMutation(api.tools.create), { success: "Tool listed" });

  return (
    <div className="max-w-xl">
      <PageHeader title="List a tool" subtitle="Neighbors will be able to request it for up to 30 days." />
      <Card>
        <ToolForm
          submitLabel="List tool"
          pending={pending}
          onSubmit={async (input) => {
            if (await create(input)) router.push("/me/listings");
          }}
          onCancel={() => router.back()}
        />
      </Card>
    </div>
  );
}
