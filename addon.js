const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const sharp = require('sharp');

// --- Configuration ---
const ENIGMA2_IP = process.env.ENIGMA2_IP;
const ENIGMA2_PORT = process.env.ENIGMA2_PORT || 80;
const ENIGMA2_STREAM_PORT = process.env.ENIGMA2_STREAM_PORT || 8002;
const ENIGMA2_PICONS = (process.env.ENIGMA2_PICONS || 'YES').toUpperCase() === 'YES';
const ADDON_PORT = process.env.ADDON_PORT || 7000;
const CATALOG_PREFIX = process.env.PREFIX_CATALOG || 'E2 - ';
const IGNORE_BOUQUETS = process.env.IGNORE_BOUQUETS ? 
    process.env.IGNORE_BOUQUETS.split(',').map(b => b.trim()) : [];
const IGNORE_EMPTY_BOUQUETS = (process.env.IGNORE_EMPTY_BOUQUETS || 'YES').toUpperCase() === 'YES';

if (!ENIGMA2_IP) {
    console.error("CRITICAL ERROR: ENIGMA2_IP must be set as environment variable.");
    process.exit(1);
}

// --- Cache ---
let bouquetsCache = { data: null, timestamp: 0 };
let channelsCache = new Map();
const metaCache = new Map();
const piconCache = new Map();

// --- Fetch and convert picon to square ---
async function getSquarePicon(sref, channelName) {
    if (!ENIGMA2_PICONS) return null;
    
    const cacheKey = sref;
    if (piconCache.has(cacheKey)) {
        return piconCache.get(cacheKey);
    }
    
    try {
        let piconFilename = sref.replace(/:/g, '_');
        piconFilename = piconFilename.replace(/_+$/, '');
        const piconUrl = `http://${ENIGMA2_IP}/picon/${piconFilename}.png`;
        
        const response = await fetch(piconUrl, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) {
            return null;
        }
        
        const imageBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);
        
        const squareBuffer = await sharp(buffer)
            .resize(300, 300, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
        
        const dataUrl = `data:image/png;base64,${squareBuffer.toString('base64')}`;
        piconCache.set(cacheKey, dataUrl);
        
        return dataUrl;
        
    } catch (error) {
        return null;
    }
}

// --- Preload ALL picons for all bouquets ---
async function preloadAllPicons() {
    if (!ENIGMA2_PICONS) {
        console.log('🖼️ Picons disabled - skipping preload');
        return;
    }
    
    console.log('🖼️ Preloading ALL logos for all bouquets...');
    
    try {
        const bouquets = await getBouquets();
        let totalChannels = 0;
        let successfulLoads = 0;
        let failedLoads = 0;
        
        for (const bouquet of bouquets) {
            try {
                const channels = await getChannelsForBouquet(bouquet.ref);
                totalChannels += channels.length;
                
                console.log(`   📦 Preloading ${channels.length} logos from ${bouquet.displayName}...`);
                
                // Load ALL picons from this bouquet in small batches
                const batchSize = 15;
                for (let i = 0; i < channels.length; i += batchSize) {
                    const batch = channels.slice(i, i + batchSize);
                    const promises = batch.map(channel => 
                        getSquarePicon(channel.sref, channel.name)
                    );
                    
                    const results = await Promise.allSettled(promises);
                    
                    const batchSuccessful = results.filter(r => r.status === 'fulfilled' && r.value).length;
                    const batchFailed = results.filter(r => r.status === 'fulfilled' && !r.value).length;
                    
                    successfulLoads += batchSuccessful;
                    failedLoads += batchFailed;
                    
                    const progress = Math.min(i + batchSize, channels.length);
                    console.log(`      📊 ${bouquet.displayName}: ${progress}/${channels.length} (${batchSuccessful}✅ ${batchFailed}❌)`);
                    
                    // Small delay between batches to be gentle on the server
                    if (i + batchSize < channels.length) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
                
                console.log(`   ✅ ${bouquet.displayName}: ${successfulLoads} logos loaded`);
                
            } catch (error) {
                console.error(`   ❌ Failed to load ${bouquet.displayName}:`, error.message);
            }
        }
        
        console.log(`🎉 Picon preload COMPLETE: ${successfulLoads}/${totalChannels} logos successfully loaded`);
        if (failedLoads > 0) {
            console.log(`   ${failedLoads} logos failed to load (missing picons)`);
        }
        
    } catch (error) {
        console.error('❌ Picon preload failed:', error.message);
    }
}

// --- Get all available bouquets (with filtering) ---
async function getBouquets() {
    const now = Date.now();
    if (bouquetsCache.data && (now - bouquetsCache.timestamp) < 300000) {
        return bouquetsCache.data;
    }
    
    try {
        const url = `http://${ENIGMA2_IP}:${ENIGMA2_PORT}/web/getservices`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        
        const xmlText = await response.text();
        let bouquets = parseBouquetsXml(xmlText);
        
        // Filter out ignored bouquets
        if (IGNORE_BOUQUETS.length > 0) {
            const originalCount = bouquets.length;
            bouquets = bouquets.filter(bouquet => {
                const shouldIgnore = IGNORE_BOUQUETS.some(ignorePattern => 
                    bouquet.ref.includes(ignorePattern)
                );
                return !shouldIgnore;
            });
            console.log(`📡 Filtered ${originalCount - bouquets.length} bouquets, keeping ${bouquets.length}`);
        }
        
        // Filter out empty bouquets if enabled
        if (IGNORE_EMPTY_BOUQUETS) {
            const originalCount = bouquets.length;
            const bouquetsWithChannels = [];
            
            for (const bouquet of bouquets) {
                try {
                    const channels = await getChannelsForBouquet(bouquet.ref);
                    if (channels.length > 0) {
                        bouquetsWithChannels.push(bouquet);
                    } else {
                        console.log(`   🗑️  Ignoring empty bouquet: ${bouquet.name}`);
                    }
                } catch (error) {
                    // If we can't fetch channels, assume it's empty and ignore it
                    console.log(`   🗑️  Ignoring bouquet (failed to load): ${bouquet.name}`);
                }
            }
            
            bouquets = bouquetsWithChannels;
            console.log(`📡 Filtered ${originalCount - bouquets.length} empty bouquets, keeping ${bouquets.length}`);
        }
        
        // Apply catalog prefix
        bouquets = bouquets.map(bouquet => ({
            ...bouquet,
            displayName: CATALOG_PREFIX + bouquet.name
        }));
        
        bouquetsCache.data = bouquets;
        bouquetsCache.timestamp = now;
        
        console.log(`📡 Found ${bouquets.length} bouquets after filtering:`);
        bouquets.forEach(bouquet => {
            console.log(`   📺 ${bouquet.displayName} (${bouquet.ref})`);
        });
        
        return bouquets;
        
    } catch (error) {
        console.error('Failed to fetch bouquets:', error.message);
        if (bouquetsCache.data) return bouquetsCache.data;
        throw error;
    }
}

// --- Parse bouquets XML ---
function parseBouquetsXml(xmlString) {
    const bouquets = [];
    const serviceRegex = /<e2service>(.*?)<\/e2service>/gs;
    let match;

    while ((match = serviceRegex.exec(xmlString)) !== null) {
        const serviceXml = match[1];
        const nameMatch = /<e2servicename>(.*?)<\/e2servicename>/.exec(serviceXml);
        const refMatch = /<e2servicereference>(.*?)<\/e2servicereference>/.exec(serviceXml);
        const name = nameMatch ? nameMatch[1].trim() : null;
        const ref = refMatch ? refMatch[1].trim() : null;

        if (name && ref && !name.startsWith('---') && name !== '<n/a>' && ref.includes('FROM BOUQUET')) {
            bouquets.push({
                name: name,
                ref: ref,
                id: `bouquet_${Buffer.from(ref).toString('base64url')}`
            });
        }
    }
    return bouquets;
}

// --- Get channels for a specific bouquet ---
async function getChannelsForBouquet(bouquetRef) {
    const now = Date.now();
    const cached = channelsCache.get(bouquetRef);
    
    if (cached && (now - cached.timestamp) < 300000) {
        return cached.data;
    }
    
    try {
        const endpoint = `web/getservices?sRef=${encodeURIComponent(bouquetRef)}`;
        const url = `http://${ENIGMA2_IP}:${ENIGMA2_PORT}/${endpoint}`;
        
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        
        const xmlText = await response.text();
        const channels = parseChannelsXml(xmlText);
        
        channelsCache.set(bouquetRef, { data: channels, timestamp: now });
        return channels;
        
    } catch (error) {
        console.error(`Failed to fetch channels for bouquet:`, error.message);
        if (cached) return cached.data;
        throw error;
    }
}

// --- Parse channels XML ---
function parseChannelsXml(xmlString) {
    const channels = [];
    const serviceRegex = /<e2service>(.*?)<\/e2service>/gs;
    let match;

    while ((match = serviceRegex.exec(xmlString)) !== null) {
        const serviceXml = match[1];
        const nameMatch = /<e2servicename>(.*?)<\/e2servicename>/.exec(serviceXml);
        const srefMatch = /<e2servicereference>(.*?)<\/e2servicereference>/.exec(serviceXml);
        const name = nameMatch ? nameMatch[1].trim() : null;
        const sref = srefMatch ? srefMatch[1].trim() : null;

        if (name && sref && !name.startsWith('---') && !sref.includes('1:64:')) {
            channels.push({ 
                name: name, 
                sref: sref,
                isHD: name.toLowerCase().includes('hd')
            });
        }
    }
    return channels;
}

// --- Meta Mapping ---
function mapServiceToMeta(service, bouquetId) {
    const id = `enigma2_${bouquetId}_${Buffer.from(service.sref).toString('base64url')}`;
    
    // Get picon from cache (preloaded during server startup)
    const posterUrl = piconCache.get(service.sref) || null;

    metaCache.set(id, { name: service.name, sref: service.sref, bouquetId });

    return {
        id: id,
        type: 'tv',
        name: service.name,
        poster: posterUrl,
        posterShape: 'square',
        genres: service.isHD ? ['HD'] : undefined,
        description: `Live TV channel`
    };
}

// --- Create manifest with dynamic catalogs ---
async function createManifest() {
    const bouquets = await getBouquets();
    
    const catalogs = bouquets.map(bouquet => ({
        type: 'tv',
        id: bouquet.id,
        name: bouquet.displayName,
        extra: [{ name: 'search', isRequired: false }]
    }));
    
    return {
        id: 'enigma2.multi.bouquet.addon',
        version: '2.6.0',
        name: `Enigma2 TV (${ENIGMA2_IP})`,
        description: `Live TV from Enigma2 receiver at ${ENIGMA2_IP} - Multiple Bouquets`,
        resources: ['catalog', 'stream'],
        types: ['tv'],
        catalogs: catalogs
    };
}

// --- Preload data and start server ---
async function startServer() {
    console.log(`Starting addon:
  IP: ${ENIGMA2_IP}
  Stream Port: ${ENIGMA2_STREAM_PORT}
  Picons: ${ENIGMA2_PICONS ? 'ENABLED' : 'DISABLED'}
  Catalog Prefix: "${CATALOG_PREFIX}"
  Ignore Bouquets: ${IGNORE_BOUQUETS.length > 0 ? IGNORE_BOUQUETS.join(', ') : 'None'}
  Ignore Empty Bouquets: ${IGNORE_EMPTY_BOUQUETS ? 'YES' : 'NO'}`);
    
    console.log('🚀 Starting Stremio Multi-Bouquet Enigma2 Addon...');
    
    try {
        // Step 1: Preload bouquets
        console.log('📡 Loading bouquets...');
        await getBouquets();
        
        // Step 2: Preload ALL channels and picons
        console.log('🔄 Preloading all channels and logos...');
        await preloadAllPicons();
        
        // Step 3: Create manifest with all data ready
        console.log('📝 Creating manifest...');
        const manifest = await createManifest();
        const builder = new addonBuilder(manifest);
        
        // --- Catalog Handler ---
        builder.defineCatalogHandler(async (args) => {
            try {
                const bouquets = await getBouquets();
                
                if (!args.id) {
                    return { metas: [] };
                }
                
                const bouquet = bouquets.find(b => b.id === args.id);
                if (!bouquet) {
                    console.log(`❌ Bouquet not found: ${args.id}`);
                    return { metas: [] };
                }

                const channels = await getChannelsForBouquet(bouquet.ref);
                
                let filteredChannels = channels;
                if (args.extra && args.extra.search) {
                    const searchTerm = args.extra.search.toLowerCase();
                    filteredChannels = channels.filter(channel => 
                        channel.name.toLowerCase().includes(searchTerm)
                    );
                }
                
                const metas = filteredChannels.map(channel => mapServiceToMeta(channel, bouquet.id));
                
                const channelsWithPicons = metas.filter(meta => meta.poster).length;
                console.log(`✅ Serving ${metas.length} channels from ${bouquet.displayName} (${channelsWithPicons} with preloaded logos)`);
                
                return { metas };

            } catch (error) {
                console.error(`Error in catalog handler: ${error.message}`);
                return { metas: [] };
            }
        });

        // --- Stream Handler ---
        builder.defineStreamHandler(async (args) => {
            if (!args.id || !args.id.startsWith('enigma2_')) {
                return { streams: [] };
            }

            try {
                const channelData = metaCache.get(args.id);
                if (!channelData) {
                    return { streams: [] };
                }

                const { name, sref } = channelData;
                const streamUrl = `http://${ENIGMA2_IP}:${ENIGMA2_STREAM_PORT}/${sref}`;
                
                console.log(`[Stream] ${name}: ${streamUrl}`);

                return { 
                    streams: [{ 
                        title: `${name} (Live)`,
                        url: streamUrl,
                        behaviorHints: { binge: true }
                    }] 
                };

            } catch (error) {
                console.error(`Error in stream handler: ${error.message}`);
                return { streams: [] };
            }
        });

        // Step 4: Start the server
        serveHTTP(builder.getInterface(), { port: ADDON_PORT }).then(() => {
            console.log(`🎉 Addon running on port ${ADDON_PORT}`);
            console.log(`📺 Manifest: http://localhost:${ADDON_PORT}/manifest.json`);
            console.log(`🖼️ ALL logos preloaded and cached!`);
        }).catch(error => {
            console.error('❌ Failed to start addon:', error);
            process.exit(1);
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();