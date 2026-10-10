import { neon } from "@neondatabase/serverless";
let q: ReturnType<typeof neon> | null = null;
export const dbReady = () => !!process.env.DATABASE_URL;
export const db = () => (q ??= neon(process.env.DATABASE_URL!));
export const CH = ["vibration", "temperature", "rpm", "pressure"] as const;
