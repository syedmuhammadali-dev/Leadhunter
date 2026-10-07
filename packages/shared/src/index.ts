import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("leadhunter-api"),
  database: z.enum(["up", "down"]),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
