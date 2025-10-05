# Enigma2Stremio Addon

A Docker-based Stremio addon that streams live TV from your Enigma2 receiver (Dreambox, VU+, etc.) directly to Stremio. Automatically imports all bouquets and channels with HD support and picon logos.

## Features

- 📺 **Multi-bouquet support** - Automatically detects all TV bouquets
- 🖼️ **Picon support** - Channel logos with automatic square conversion
- 🏷️ **HD detection** - Automatically tags HD channels
- ⚡ **Smart caching** - Optimized performance with 5-minute cache
- 🐳 **Dockerized** - Easy deployment with Docker Compose
- 🔄 **Manual refresh** - HTTP endpoints for cache management

## Quick Start

### 1. Create configuration files

**docker-compose.yml**
```yaml
version: '3.8'

services:
  enigma2-stremio-addon:
    image: adriankoooo/enigma2-stremio-addon:latest
    container_name: enigma2-stremio-addon
    ports:
      - "${ADDON_PORT}:7000"
    environment:
      - ENIGMA2_IP=${ENIGMA2_IP}
      - ENIGMA2_PORT=${ENIGMA2_PORT}
      - ENIGMA2_STREAM_PORT=${ENIGMA2_STREAM_PORT}
      - ENIGMA2_PICONS=${ENIGMA2_PICONS}
      - PREFIX_CATALOG=${PREFIX_CATALOG}
      - IGNORE_BOUQUETS=${IGNORE_BOUQUETS}
      - IGNORE_EMPTY_BOUQUETS=${IGNORE_EMPTY_BOUQUETS}
    restart: unless-stopped
```

**.env**
```bash
# REQUIRED: The IP address or hostname of your Enigma2 box
ENIGMA2_IP=192.168.1.100

# OPTIONAL: The OpenWebif API port (defaults to 80)
ENIGMA2_PORT=80

# OPTIONAL: The raw DVB stream port (defaults to 8001, you can use 8002 for converted streams on some Vu+ models)
ENIGMA2_STREAM_PORT=8001

# OPTIONAL: Enable picon support (YES/NO, defaults to YES)
ENIGMA2_PICONS=YES

# OPTIONAL: Addon server port (defaults to 7000)
ADDON_PORT=7000

# OPTIONAL: Prefix for catalog names in Stremio (defaults to "E2 - ")
PREFIX_CATALOG=E2 -

# OPTIONAL: Comma-separated list of bouquets to ignore
IGNORE_BOUQUETS="userbouquet.LastScanned.tv"

# OPTIONAL: Ignore empty bouquets (YES/NO, defaults to YES)
IGNORE_EMPTY_BOUQUETS=YES
```

### 2. Start the addon
```bash
docker-compose up
```

Your addon is running at **your_server_ip:7000**. You can verify this by visiting the manifest URL: `http://server_ip:7000/manifest.json`

Once you've confirmed that the addon is working correctly, you can run `docker-compose up -d` to run the server in the background.

### 3. Add to Stremio

**Note:** Stremio requires **HTTPS** for all addons. You must use a reverse proxy or tunneling service (like Cloudflare, Nginx, or ngrok) to secure your connection.

**Example:** Proxy `http://server_ip:7000` to `https://enigma2stremio.your-domain.com`

1. Open your secured addon URL: `https://enigma2stremio.yourdomain.com`

2. Click **Install**.

3. Done! You can find your channels under **Discovery -> TV Channels**.

The addon also works with AIOStreams. To install, paste your HTTPS URL into the following location:

**Addons -> Marketplace -> Custom**

**URL:** `https://enigma2stremio.your-domain.com/manifest.json`

