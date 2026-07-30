export interface AnalyticsOverview {
  total_conversations: number;
  open_count: number;
  resolved_count: number;
  snoozed_count: number;
  avg_first_response_minutes: number | null;
  avg_resolution_minutes: number | null;
  resolution_rate: number | null;
}

export interface ChannelBreakdown {
  channel: "chat" | "email";
  total: number;
  resolved_count: number;
}

export interface HourBucket {
  hour_of_day: number;
  total: number;
}

export interface AgentBreakdown {
  user_id: string;
  email: string;
  assigned_count: number;
  resolved_count: number;
  avg_resolution_minutes: number | null;
}
