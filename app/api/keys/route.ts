import { byok, houseServices, usingOwnKey, SERVICES } from "@/lib/keys";

// POST → { house: {service: bool}, own: {service: bool} }: which services this site can run on its own
// keys, and which this request brought its own key for. Never returns a key.
// POST (not GET): Next 16 Cache Components prerenders GET handlers.
async function handle() {
  return Response.json({
    house: houseServices(),
    own: Object.fromEntries(SERVICES.map((s) => [s, usingOwnKey(s)])),
  });
}

export const POST = byok(handle);
