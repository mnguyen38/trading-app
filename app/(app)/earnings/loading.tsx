import { PageHeaderSkeleton, TwoColumnSkeleton } from "@/src/components/arena/Skeletons";

export default function Loading() {
  return (
    <div className="animate-pulse">
      <PageHeaderSkeleton />
      <TwoColumnSkeleton />
    </div>
  );
}
