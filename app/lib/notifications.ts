// Owner: A. Shape of a row in public.notifications (supabase/notifications.sql), written by the QuickNode
// Stream pipeline (lib/server/notify.ts) and shown by components/NotificationBell.tsx.
export interface AppNotification {
  id: string;
  wallet: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  tx_signature: string | null;
  created_at: string;
  read_at: string | null;
}
