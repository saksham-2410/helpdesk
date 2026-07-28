import { PageHeader, EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader title="Analytics" description="Response times and resolution rates." />
      <EmptyState
        title="Not enough data yet"
        description="Once conversations start flowing, response and resolution metrics appear here."
      />
    </>
  );
}
