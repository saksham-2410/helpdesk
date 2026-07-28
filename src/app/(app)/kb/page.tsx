import { PageHeader, EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Knowledge base" };

export default function KbPage() {
  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Help articles for your customers, and answers the widget can suggest."
      />
      <EmptyState
        title="No articles yet"
        description="Published articles appear on your public help centre and are suggested in the chat widget as customers type."
      />
    </>
  );
}
