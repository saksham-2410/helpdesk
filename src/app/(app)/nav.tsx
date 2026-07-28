"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const ITEMS = [
  {
    href: "/inbox",
    label: "Inbox",
    icon: (
      <>
        <rect x="2.5" y="3.5" width="13" height="11" rx="2" strokeWidth="1.3" />
        <path d="M2.5 10.5h3.2l1 1.6h4.6l1-1.6h3.2" strokeWidth="1.3" strokeLinejoin="round" />
      </>
    ),
  },
  {
    href: "/kb",
    label: "Knowledge",
    icon: (
      <>
        <path d="M3 4.2A1.2 1.2 0 0 1 4.2 3H8v11H4.2A1.2 1.2 0 0 1 3 12.8V4.2Z" strokeWidth="1.3" />
        <path d="M15 4.2A1.2 1.2 0 0 0 13.8 3H10v11h3.8A1.2 1.2 0 0 0 15 12.8V4.2Z" strokeWidth="1.3" />
      </>
    ),
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: (
      <>
        <path d="M3 14.5V9m4.3 5.5v-9m4.4 9V7m4.3 7.5v-4" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <>
        <circle cx="9" cy="9" r="2.2" strokeWidth="1.3" />
        <path
          d="M9 2.6v1.5M9 13.9v1.5M15.4 9h-1.5M4.1 9H2.6m10.1-4.5-1 1M5.3 12.7l-1 1m0-9.2 1 1m7.4 7.2 1 1"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </>
    ),
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {ITEMS.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8125rem] font-medium transition-colors",
              active
                ? "bg-accent-soft text-accent"
                : "text-secondary hover:bg-paper-200/70 hover:text-primary dark:hover:bg-paper-800",
            )}
          >
            {/* Active marker rather than relying on fill alone — reads at a
                glance in peripheral vision while scanning the inbox. */}
            <span
              aria-hidden
              className={cn(
                "absolute left-0 h-4 w-0.5 rounded-r-full bg-accent transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <svg
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              className="size-[18px] shrink-0"
              aria-hidden
            >
              {item.icon}
            </svg>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
