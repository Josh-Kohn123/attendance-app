import { z } from "zod";

export const LoginCallbackSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
});

export const TokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number(),
});

export type LoginCallback = z.infer<typeof LoginCallbackSchema>;
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
