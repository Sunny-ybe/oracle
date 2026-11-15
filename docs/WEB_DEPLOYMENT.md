# Deploy the website branch without merging main

Branch: `feat/web-explore-redesign`.

## Render preview (the simplest fit for this repository)

Oracle is an Express server that serves the website and APIs together. Keep one running Node process: open questions and live event subscribers are held in memory. This branch does not change the live Vultr deployment.

1. Open https://dashboard.render.com and choose **New → Web Service**.
2. Connect `Sunny-ybe/oracle`. Select branch **feat/web-explore-redesign**. Leave Root Directory blank (repository root).
3. Choose **Node**, Build Command `npm ci`, Start Command `npm start`, and the **Free** instance. Optionally set health check path `/api/ping`. Turn off automatic deploys if you only want manual previews.
4. Add environment variables through Render's Environment panel. Use `.env.example` for the full names; never commit the local `.env`.
   - Required data connections: `MONGODB_URI`, `MONGODB_DB`, `TIGER_DATABASE_URL`. Use separate preview databases so testing does not touch the team's live users or payouts. Provision the Tiger schema from `schema.sql` into that preview database first. Allow Render's outbound IPs in your database network rules if required.
   - Set `SESSION_SECRET` to a strong random value for the preview, and `ORACLE_API_KEY` to a separate strong random value. Preserve secrets across redeploys; changing the session secret signs users out.
   - Set `PUBLIC_URL` to the Render HTTPS service URL (for example `https://your-service.onrender.com`). Once the URL is assigned, save it and redeploy if needed.
   - Set `AUTO_IMPORT_PLACES=0` to prevent startup imports, and leave `GEO_BIAS` empty for no preferred campus area.
   - Optional AI/photo/web fallback: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_PLACES_API_KEY`, `TINYFISH_API_KEY`. Add only integrations you intend to enable. Worldwide OpenStreetMap search does not need these keys.
   - Leave `TELEGRAM_TOKEN` and `DISCORD_TOKEN` **unset** on this preview. Bots remain on the existing Vultr server. `DISCORD_INVITE_URL` is just a public join link and can be configured separately.
   - Leave Solana treasury and APNs credentials unset for a visual preview unless deliberately testing those integrations against isolated resources.
   - Render supplies `PORT`; don't hardcode it to 3000.
5. Click **Create Web Service**. Check the deployment logs for successful Mongo/Tiger connections.
6. Open `https://your-service.onrender.com/app?welcome=1`. Check Home, worldwide Explore search, Requests, and Rewards. `/api/ping` should return JSON. MCP clients use `https://your-service.onrender.com/mcp` with the configured agent key.

Free services sleep after 15 minutes without inbound traffic and can take about a minute to wake. Sleeping/redeploying clears Oracle's in-memory open questions; this is a preview option, not an always-on bot host. Keep the existing Vultr service for an uninterrupted event demo.

## Vercel

Vercel supports Express, but maps the application to a Vercel Function. This repository relies on in-memory questions, timers, SSE subscribers, and optional polling bots, so deploying it unchanged as a function is not the recommended setup. Serving only `public/` also won't make it functional: its same-origin `/api/*` and `/mcp` routes need the Node backend.

For a later Vercel frontend, first keep the backend on Vultr/Render and configure explicit rewrites for all backend routes and shared media. That split is not configured in this branch. The Render instructions above deploy the complete branch together.

## Map/search setup

The web app uses standard OpenStreetMap street tiles and explicit worldwide Nominatim searches. Search only runs after pressing Search, is cached, and shares a server-side request limiter with the existing geocoder. No autocomplete or tile prefetching. Attribution remains visible. For greater traffic, choose a suitable hosted/self-hosted provider; `PLACE_SEARCH_URL` can select a compatible search endpoint. The public Nominatim service has no availability guarantee.

Apple Maps links work without a developer account. Embedded MapKit JS requires an Apple Maps token and is not configured.

References:
- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/free
- https://vercel.com/docs/frameworks/backend/express
- https://operations.osmfoundation.org/policies/nominatim/
- https://operations.osmfoundation.org/policies/tiles/
