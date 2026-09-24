import { z } from "zod";

export const createOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(999),
    customization: z.any().optional(),
  })).min(1, "Корзина пуста"),
  deliveryAddress: z.string().optional(),
  deliveryDate: z.string().min(1, "Укажите дату доставки"),
  deliveryTime: z.string().optional(),
  deliveryCost: z.number().min(0).max(5000).default(0),
  paymentMethod: z.enum(["card", "sbp", "cash", "split", "installment"]).default("card"),
  comment: z.string().max(1000).optional(),
  promoCode: z.string().optional(),
  bonusPointsToRedeem: z.number().int().min(0).optional(),
  isCorporate: z.boolean().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
