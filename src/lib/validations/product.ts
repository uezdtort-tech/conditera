import { z } from "zod";

export const createProductSchema = z.object({
  title: z.string().min(3, "Название минимум 3 символа"),
  slug: z.string().min(3).optional(),
  description: z.string().min(10, "Описание минимум 10 символов"),
  price: z.number().int().min(1, "Цена минимум 1₽"),
  category: z.string().min(1),
  images: z.array(z.string()).min(1, "Минимум 1 изображение"),
  weight: z.string().optional(),
  fillings: z.any().optional(),
  coatings: z.any().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
