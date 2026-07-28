import { PageHeader, EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Team, widget, email, and custom domains." />
      <EmptyState title="Settings" description="Team management lands here next." />
    </>
  );
}
