import { z } from "zod";

export const createReviewSchema = z.object({
  productId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(10, "Отзыв минимум 10 символов").max(2000),
  images: z.array(z.string()).max(5).optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
