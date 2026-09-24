import { z } from "zod";

export const createPaymentSchema = z.object({
  orderId: z.string().min(1, "Укажите orderId"),
  installmentPlanId: z.string().optional(),
});

export const payoutRequestSchema = z.object({
  amount: z.number().int().min(100, "Минимальная выплата 100₽"),
  totpCode: z.string().length(6).optional(),
  backupCode: z.string().optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>;
