import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The request or page you're looking for doesn't exist or may have been removed."
        action={
          <Link href="/requests" className={buttonVariants()}>
            Go to requests
          </Link>
        }
      />
    </main>
  );
}
