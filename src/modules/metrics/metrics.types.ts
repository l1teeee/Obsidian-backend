import { RowDataPacket } from 'mysql2';

// ─── DB ───────────────────────────────────────────────────────────────────────

export interface FacebookConnectionRow extends RowDataPacket {
  page_id:      string;
  access_token: string;
  account_name: string;
}

// ─── Graph API response shapes ────────────────────────────────────────────────

export interface FbInsightValue {
  value:    number | Record<string, number>;
  end_time: string;
}

export interface FbInsightItem {
  name:   string;
  values: FbInsightValue[];
}

export interface FbInsightsResponse {
  data:   FbInsightItem[];
  error?: { code: number; message: string; type: string };
}

export interface FbPageFieldsResponse {
  id:        string;
  fan_count: number;
  error?: { code: number; message: string; type: string };
}

export interface FbAttachment {
  type:   string;
  media?: { image?: { src: string } };
}

export interface FbPost {
  id:           string;
  message?:     string;
  created_time: string;
  attachments?: { data: FbAttachment[] };
  insights?:    { data: FbInsightItem[] };
}

export interface FbPostsResponse {
  data:   FbPost[];
  error?: { code: number; message: string; type: string };
}

// ─── Public service types ─────────────────────────────────────────────────────

export interface PostMetrics {
  id:            string;
  message:       string | null;
  created_time:  string;
  thumbnail:     string | null;
  impressions:   number;
  reach:         number;
  engaged_users: number;
  reactions:     number;
}

export interface FacebookSummary {
  fan_count:         number;
  impressions_30d:   number;
  reach_30d:         number;
  engaged_users_30d: number;
  period: {
    since: string;
    until: string;
  };
}
