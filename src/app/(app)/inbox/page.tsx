import { PageHeader, EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Inbox" };

export default function InboxPage() {
  return (
    <>
      <PageHeader
        title="Inbox"
        description="Chat and email conversations in one place."
      />
      <EmptyState
        title="No conversations yet"
        description="Install the chat widget on your site or send an email to your support address, and conversations will land here."
      />
    </>
  );
}
