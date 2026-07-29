import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Inbox" };

/** Rendered inside the list-pane layout when no conversation is selected. */
export default function InboxPage() {
  return (
    <EmptyState
      title="Select a conversation"
      description="Chat and email conversations for this workspace appear in the list on the left. Install the widget or email your support address to see one land here live."
    />
  );
}
