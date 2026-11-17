import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallbacks. Each roughly matches the shape of what it replaces. */

export function TableSkeleton({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="border-b bg-muted/60 px-4 py-3">
        <Skeleton className="h-3.5 w-1/3" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3.5">
            <div className="w-48 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="hidden h-3.5 w-40 sm:block" />
            <Skeleton className="hidden h-3.5 w-24 md:block" />
            <Skeleton className="ml-auto h-5 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ToolbarSkeleton() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-8 w-64" />
    </div>
  );
}

export function CardSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="flex gap-6">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DetailSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-7 w-64" />
        <div className="flex gap-8">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CardSkeleton lines={6} />
          <CardSkeleton lines={3} />
        </div>
        <div className="space-y-6">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={5} />
        </div>
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div role="status" aria-label="Loading form" className="space-y-6">
      {[2, 4, 2].map((fields, s) => (
        <Card key={s}>
          <CardHeader>
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            {Array.from({ length: fields }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
