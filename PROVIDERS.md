# Providers

- Paper uses the official Fill v3 downloads service and sends the required identifying User-Agent: https://docs.papermc.io/misc/downloads-service/
- Purpur uses the official v2 downloads API: https://api.purpurmc.org/
- Vanilla uses Mojang launcher metadata at `piston-meta.mojang.com` and verifies the published server SHA-1.
- Java uses the Eclipse Adoptium API v3: https://api.adoptium.net/
- Hangar uses its public REST API for Paper plugin projects and versions.
- Modrinth uses API v2 search/version endpoints, its stable IDs, rate-limit headers, and an identifying User-Agent: https://docs.modrinth.com/api/

Provider failures are isolated. A store search can return healthy-provider results while another provider is unavailable.
