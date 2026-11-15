# Native iPhone integration

The SwiftUI app is in ios/Oracle/Oracle.xcodeproj. Configure the app with this server's public HTTPS base URL and sign in with an Oracle account. Native account sessions use x-oracle-token, identical to the web account API.

Added routes

- GET /api/app/places/nearby?lat=...&lng=...&radiusM=3000 returns known Oracle places within the specified radius, with distanceM. Radius is capped at 50 km. The iPhone also discovers new venues through MapKit, then registers a venue through /api/places/ensure when opening its reports.
- POST /api/app/discover with {query} interprets map search terms through Gemini. Requires an Oracle session. Without GEMINI_API_KEY it returns the original query. Coordinates are resolved by MapKit.
- POST /api/app/venue-media with {placeId,name,lat,lng} returns {url,attribution,source}. Public venue imagery. Uses an Oracle masked photo first, then optional Google Places API (New) photos. Configure GOOGLE_PLACES_API_KEY. Google images show their supplied attribution and are venue imagery, not proof of current conditions.
- POST /api/app/ask and GET /api/app/questions/:id expose the existing question engine to authenticated native clients. The current UI directs asking through the AI assistant setup card.
- POST /mcp exposes the same five tools as mcp/oracle-mcp.js through stateless Streamable HTTP. Configure ORACLE_URL to the internal REST address. ORACLE_API_KEY, if set, is required as x-oracle-key. Clients that cannot supply this header require a compatible authentication gateway. This server does not provide OAuth.

Existing /api/app/me, /checkin, /answer/:id, /redeem and /wallet routes power the native responder flow. The iPhone supports native photo and noise capture. Web push is retained, and optional APNs delivery uses APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID and APNS_BUNDLE_ID. Native device registration uses /api/app/apns; Apple sign-in uses /api/app/oauth/apple. The native client also refreshes Requests while visible.

GET /api/app/config includes the public MCP URL derived from PUBLIC_URL, authentication capability metadata, and integration flags, with no secrets. GET /api/game/rounds?lat=...&lng=... requires eight distinct eligible photo-backed crowd reports within 3 km; otherwise it returns an empty rounds array. Run node scripts/test-game.js for the eligibility regression checks.

Useful setup references

- https://developers.google.com/maps/documentation/places/web-service/place-photos
- https://developers.google.com/maps/documentation/urls/get-started
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
