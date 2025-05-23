import { configuration } from "./configuration";
import { handleRequest, handleOptions, handleSchedule } from "./handler";

export interface Env {
  /**
   * Environment variables for Supabase
   */
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  
  // Keep D1 for backward compatibility or remove if no longer needed
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const isMethodAllowed = configuration.methods.includes(request.method);

    if (!isMethodAllowed)
      return new Response(null, {
        status: 405,
        statusText: "Method Not Allowed",
      });

    if (request.method === "OPTIONS") {
      return handleOptions(request); // handle cuando haces una petición desde fuera
    } else {
      return handleRequest(request, env); // handle cuando haces una petición desde dentro(ejemplo desde el schedule o local)
    }
  },
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: EventContext<Env, any, any>
  ) {
    ctx.waitUntil(handleSchedule(event, env));
  },
};
