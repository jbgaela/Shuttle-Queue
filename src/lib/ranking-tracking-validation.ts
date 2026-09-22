import { z } from "zod";

const date = z.string().datetime();
const nullableDate = date.nullish().transform((value) => value ?? null);
const nullableText = z.string().nullish().transform((value) => value ?? null);
const status = z.enum(["PENDING", "GRANTED", "DENIED", "TIMEOUT", "UNAVAILABLE"]);
export const rankingVisitAccessSchema = z.object({ visitId: z.string().min(1), status, accessExpiresAt: nullableDate });
const link = z.object({ id: z.string().min(1), queueMasterId: z.string().min(1), issuedAt: date, revokedAt: nullableDate, publication: z.object({ id: z.string().min(1), sessionStartedAt: date, sessionEndedAt: nullableDate, finalizedAt: nullableDate }) });
const visit = z.object({
  id: z.string().min(1), openedAt: date, locationReceivedAt: nullableDate, accessExpiresAt: nullableDate,
  ipAddress: z.string(), device: z.string(), browser: z.string(), operatingSystem: z.string(),
  city: nullableText, region: nullableText, country: nullableText, locationStatus: status,
  latitude: z.number().min(-90).max(90).nullish().transform((value) => value ?? null),
  longitude: z.number().min(-180).max(180).nullish().transform((value) => value ?? null),
  accuracy: z.number().nonnegative().finite().nullish().transform((value) => value ?? null),
});
export const rankingTrackingLinksSchema = z.object({ items: z.array(link).max(100), nextCursor: z.string().nullable() });
export const rankingTrackingVisitsSchema = z.object({ link, items: z.array(visit).max(100), nextCursor: z.string().nullable() });

export function validatedTracking<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Tracking information could not be read. Please refresh and try again.");
  return parsed.data;
}
