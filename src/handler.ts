import { Env } from ".";
import { scrapeAsuraScans } from "./routes/asura.route"; 
import { scrapeRizzFablesScans } from "./routes/rizzfables.route";
import { scrapeQuantumScans } from "./routes/quantum.route";
import { scrapeHiveComic } from "./routes/hivecomic.route";
import { scrapeFlameComics } from "./routes/flamecomics.route";

const configuration = {
  //   host: '*',
  // * For CORS
  host: "https://example.com",
  referer: "https://example.com",
  methods: ["GET", "HEAD", "POST", "OPTIONS", "PATCH"],
};

/*
 * Schedule handler
 * For handling requests made by Cloudflare's CRON trigger
 */
export async function handleSchedule(
  event: ScheduledEvent,
  env: Env
): Promise<void> {
  // Run both scrapers in parallel
  const asuraScrapePromise = scrapeAsuraScans(env)
    .then(() => console.log("Scheduled AsuraScans scraping completed successfully"))
    .catch((error) => console.error("Scheduled AsuraScans scraping failed:", error));
  const rizzScrapePromise = scrapeRizzFablesScans(env)
    .then(() => console.log("Scheduled RizzFables scraping completed successfully"))
    .catch((error) => console.error("Scheduled RizzFables scraping failed:", error));
  const quantumScrapePromise = scrapeQuantumScans(env)
    .then(() => console.log("Scheduled QuantumScans scraping completed successfully"))
    .catch((error) => console.error("Scheduled QuantumScans scraping failed:", error));
  const hiveScrapePromise = scrapeHiveComic(env)
    .then(() => console.log("Scheduled HiveComic scraping completed successfully"))
    .catch((error) => console.error("Scheduled HiveComic scraping failed:", error));
  const flameScrapePromise = scrapeFlameComics(env)
    .then(() => console.log("Scheduled FlameComics scraping completed successfully"))
    .catch((error) => console.error("Scheduled FlameComics scraping failed:", error));
  
    
  // Wait for both to complete, regardless of success/failure
  await Promise.allSettled([asuraScrapePromise, rizzScrapePromise, quantumScrapePromise, 
    hiveScrapePromise, flameScrapePromise]);
  
  
  console.log("All scheduled scraping tasks completed");
}


export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  const requestURL = new URL(request.url);
  const requestPath = requestURL.pathname;

  //* Check target URL validity
  if (
    configuration.methods &&
    !configuration.methods.includes(request.method)
  ) {
    return new Response(null, {
      status: 405,
      statusText: "Method not allowed",
    });
  }

  switch (requestPath) {
    
    case "/":
      return new Response(JSON.stringify({ msg: "Server up and running" }), {
        status: 200,
        statusText: "Server up and running",
      });
    case "/api/scrape-asura":
      return scrapeAsuraScans(env);
    case "/api/scrape-rizz":
      return scrapeRizzFablesScans(env);
    case "/api/scrape-quantum":
      return scrapeQuantumScans(env);
    case "/api/scrape-hive":
      return scrapeHiveComic(env);
    case "/api/scrape-flame":
      return scrapeFlameComics(env);





    default:
      // * You can return a HTML body for a 404 page
      return new Response(null, {
        status: 404,
        statusText: "Request path url not defined",
      });
  }
}

export async function handleOptions(request: Request): Promise<Response> {
  /*
   * Handle CORS pre-flight request.
   * If you want to check the requested method + headers you can do that here.
   */
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null
  ) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": configuration.host,
        "Access-Control-Allow-Methods": configuration.methods.join(", "),
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });

    /*
     * Handle standard OPTIONS request.
     * If you want to allow other HTTP Methods, you can do that here.
     */
  } else {
    return new Response(null, {
      headers: {
        Allow: configuration.methods.join(", "),
      },
    });
  }
}
