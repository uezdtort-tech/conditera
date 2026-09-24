import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Пароль минимум 8 символов"),
});

export const registerSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Пароль минимум 8 символов"),
  name: z.string().min(2, "Имя минимум 2 символа"),
  phone: z.string().min(10, "Телефон минимум 10 символов"),
  role: z.enum(["CUSTOMER", "CONFECTIONER"]).default("CUSTOMER"),
  accountType: z.enum(["individual", "legal"]).default("individual"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
