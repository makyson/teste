import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  GEMINI_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash-001"),
});

export const env = Env.parse(process.env);
