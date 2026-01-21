export type Config = {
  port: number;
  databaseUrl: string;
  authToken?: string;
  publicBaseUrl: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env ${name}.`);
  }
  return value;
}

const port = Number(process.env.PORT ?? "8787");

export const config: Config = {
  port,
  databaseUrl: requireEnv("DATABASE_URL"),
  authToken: process.env.COMPANION_TOKEN,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`
};

export function buildWsUrl(): string {
  const base = new URL(config.publicBaseUrl);
  base.pathname = "/realtime";
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.search = "";
  return base.toString();
}
