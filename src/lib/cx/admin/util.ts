/** Small shared helpers of the admin package (server-safe, no imports). */
export const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
