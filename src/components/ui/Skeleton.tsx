"use client";

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-lg ${className}`}
      style={{
        background:
          "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s infinite",
        ...style,
      }}
    />
  );
}

export function BalanceSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4">
      <Skeleton className="w-20 h-3" />
      <Skeleton className="w-48 h-14" />
      <Skeleton className="w-32 h-5" />
    </div>
  );
}

export function PositionSkeleton() {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <Skeleton className="w-8 h-8 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="w-24 h-4" />
        <Skeleton className="w-36 h-3" />
      </div>
      <div className="space-y-2 text-right">
        <Skeleton className="w-16 h-4 ml-auto" />
        <Skeleton className="w-12 h-3 ml-auto" />
      </div>
    </div>
  );
}

export function PoolSkeleton() {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <div className="space-y-2">
        <Skeleton className="w-32 h-4" />
        <Skeleton className="w-24 h-3" />
      </div>
      <div className="space-y-2 text-right">
        <Skeleton className="w-16 h-4 ml-auto" />
        <Skeleton className="w-12 h-3 ml-auto" />
      </div>
    </div>
  );
}
