export type NotificationChannel = "email" | "whatsapp" | "push" | "in_app";
export type NotificationJob = {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
};
