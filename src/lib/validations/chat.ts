import { z } from "zod";

export const sendMessageSchema = z.object({
  roomId: z.string().min(1),
  message: z.string().min(1, "Сообщение не может быть пустым").max(5000),
});

export const autoReplySchema = z.object({
  roomId: z.string().min(1),
  message: z.string().min(1).max(5000),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type AutoReplyInput = z.infer<typeof autoReplySchema>;
