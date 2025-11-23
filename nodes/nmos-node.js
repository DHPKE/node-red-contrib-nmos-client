const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const bonjour = require('bonjour')();

module.exports = function(RED) {
    function NMOSNodeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.nodeLabel = config.nodeLabel || 'Node-RED NMOS Node';
        this.nodeDescription = config.nodeDescription || 'NMOS Node implemented in Node-RED';
        this.httpPort = parseInt(config.httpPort) || 1880;
        this.nodeId = config.nodeId || uuidv4();
        this.deviceId = config.deviceId || uuidv4();
        this.receiverId = config.receiverId || uuidv4();
        
        let heartbeatInterval = null;
        let registrationComplete = false;
        
        // Multi-registry support: Map of registry URL -> registry info
        const discoveredRegistries = new Map();
        let mdnsBrowser = null;
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        const getNetworkInfo = () => {
            const interfaces = os.networkInterfaces();
            let ip = '127.0.0.1';
            let mac = '00-00-00-00-00-00';
            let ifaceName = 'lo';
            
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        ip = iface.address;
                        mac = iface.mac ? iface.mac.replace(/:/g, '-') : '00-00-00-00-00-00';
                        ifaceName = name;
                        return { ip, mac, ifaceName };
                    }
                }
            }
            
            return { ip, mac, ifaceName };
        };
        
        const networkInfo = getNetworkInfo();
        const localIP = networkInfo.ip;
        const localMAC = networkInfo.mac;
        const ifaceName = networkInfo.ifaceName;
        
        const connectionAPIBase = `http://${localIP}:${node.httpPort}/x-nmos/connection/${node.registry.connectionApiVersion}`;
        
        let receiverState = {
            staged: {
                sender_id: null,
                master_enable: false,
                activation: {
                    mode: null,
                    requested_time: null,
                    activation_time: null
                },
                transport_params: [{
                    source_ip: "auto",
                    multicast_ip: "239.0.0.1",
                    interface_ip: "auto",
                    destination_port: 5004,
                    rtp_enabled: true
                }],
                transport_file: {
                    data: null,
                    type: null
                }
            },
            active: {
                sender_id: null,
                master_enable: false,
                activation: {
                    mode: null,
                    requested_time: null,
                    activation_time: null
                },
                transport_params: [{
                    source_ip: "auto",
                    multicast_ip: "239.0.0.1",
                    interface_ip: "auto",
                    destination_port: 5004,
                    rtp_enabled: true
                }],
                transport_file: {
                    data: null,
                    type: null
                }
            },
            constraints: [{
                source_ip: {},
                multicast_ip: {},
                interface_ip: {},
                destination_port: {}
            }],
            transporttype: 'urn:x-nmos:transport:rtp'
        };
        
        const getTAITimestamp = () => {
            const now = Date.now() / 1000;
            const taiSeconds = Math.floor(now) + 37;
            const taiNanoseconds = Math.floor((now % 1) * 1000000000);
            return `${taiSeconds}:${String(taiNanoseconds).padStart(9, '0')}`;
        };
        
        const getRegistrationApiUrl = () => {
            const registryBaseUrl = node.registry.registryUrl;
            const registrationVersion = node.registry.queryApiVersion;
            return `${registryBaseUrl}/x-nmos/registration/${registrationVersion}`;
        };
        
        const buildNodeResource = () => {
            const resource = {
                id: node.nodeId,
                version: getTAITimestamp(),
                label: node.nodeLabel,
                description: node.nodeDescription,
                tags: {},
                href: `http://${localIP}:${node.httpPort}/`,
                hostname: os.hostname(),
                api: {
                    versions: [node.registry.queryApiVersion],
                    endpoints: [{
                        host: localIP,
                        port: node.httpPort,
                        protocol: 'http'
                    }]
                },
                caps: {},
                services: [],
                clocks: [{
                    name: 'clk0',
                    ref_type: 'internal'
                }],
                interfaces: [{
                    name: ifaceName,
                    chassis_id: localMAC,
                    port_id: localMAC,
                    attached_network_device: {
                        chassis_id: localMAC,
                        port_id: localMAC
                    }
                }]
            };
            
            return resource;
        };
        
        const buildDeviceResource = () => {
            const resource = {
                id: node.deviceId,
                version: getTAITimestamp(),
                label: `${node.nodeLabel} Device`,
                description: 'Node-RED NMOS Device',
                tags: {},
                type: 'urn:x-nmos:device:generic',
                node_id: node.nodeId,
                senders: [],
                receivers: [node.receiverId]
            };
            
            if (node.registry.queryApiVersion >= 'v1.1') {
                resource.controls = [{
                    type: `urn:x-nmos:control:sr-ctrl/${node.registry.connectionApiVersion}`,
                    href: connectionAPIBase + '/'
                }];
            }
            
            return resource;
        };
        
        const buildReceiverResource = () => {
            const resource = {
                id: node.receiverId,
                version: getTAITimestamp(),
                label: `${node.nodeLabel} Receiver`,
                description: 'Node-RED NMOS Receiver',
                tags: {},
                format: 'urn:x-nmos:format:video',
                caps: {
                    media_types: ['video/raw']
                },
                device_id: node.deviceId,
                transport: 'urn:x-nmos:transport:rtp',
                interface_bindings: [ifaceName],
                subscription: {
                    sender_id: receiverState.active.sender_id,
                    active: receiverState.active.master_enable && receiverState.active.sender_id !== null
                }
            };
            
            return resource;
        };
        
        const generateDefaultSDP = () => {
            const params = receiverState.active.transport_params[0];
            return `v=0
o=- ${Date.now()} ${Date.now()} IN IP4 ${localIP}
s=Node-RED NMOS Receiver
t=0 0
m=video ${params.destination_port} RTP/AVP 96
c=IN IP4 ${params.multicast_ip}/32
a=rtpmap:96 raw/90000
a=source-filter: incl IN IP4 ${params.multicast_ip} ${params.source_ip === 'auto' ? '*' : params.source_ip}
a=ts-refclk:localmac=${localMAC}`;
        };
        
        const registerResource = async (type, data, registryUrl = null) => {
            try {
                const registrationApiUrl = registryUrl || getRegistrationApiUrl();
                const headers = {
                    ...node.registry.getAuthHeaders(),
                    'Content-Type': 'application/json'
                };
                
                const payload = { type, data };
                
                node.log(`Registering ${type} with ${registrationApiUrl}...`);
                
                const response = await axios.post(
                    `${registrationApiUrl}/resource`,
                    payload,
                    { 
                        headers, 
                        timeout: 10000,
                        validateStatus: (status) => status >= 200 && status < 500
                    }
                );
                
                if (response.status === 200 || response.status === 201) {
                    node.log(`✓ Registered ${type}: ${data.id}`);
                    return true;
                } else {
                    node.error(`Registration failed for ${type}: ${response.status}`);
                    node.error(`Response: ${JSON.stringify(response.data)}`);
                    return false;
                }
            } catch (error) {
                if (error.response) {
                    node.error(`Registration error for ${type}: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                } else {
                    node.error(`Registration error for ${type}: ${error.message}`);
                }
                return false;
            }
        };
        
        const registerWithRegistry = async (registryUrl = null, apiVersion = null) => {
            try {
                const regUrl = registryUrl || getRegistrationApiUrl();
                const regVersion = apiVersion || node.registry.queryApiVersion;
                
                node.status({fill: "blue", shape: "dot", text: "registering..."});
                node.log(`═══════════════════════════════════════`);
                node.log(`Registering with: ${regUrl}`);
                node.log(`Local IP: ${localIP}`);
                node.log(`Local MAC: ${localMAC}`);
                node.log(`Interface: ${ifaceName}`);
                node.log(`═══════════════════════════════════════`);
                
                const nodeSuccess = await registerResource('node', buildNodeResource(), regUrl);
                if (!nodeSuccess) {
                    throw new Error('Node registration failed');
                }
                
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const deviceSuccess = await registerResource('device', buildDeviceResource(), regUrl);
                if (!deviceSuccess) {
                    throw new Error('Device registration failed');
                }
                
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const receiverSuccess = await registerResource('receiver', buildReceiverResource(), regUrl);
                if (!receiverSuccess) {
                    throw new Error('Receiver registration failed');
                }
                
                // Track registration in discoveredRegistries
                if (registryUrl) {
                    discoveredRegistries.set(regUrl, {
                        url: regUrl,
                        apiVersion: regVersion,
                        registered: true,
                        lastHeartbeat: Date.now(),
                        priority: 100
                    });
                }
                
                registrationComplete = true;
                node.status({fill: "green", shape: "dot", text: "registered"});
                node.log('═══════════════════════════════════════');
                node.log(`✓ REGISTERED WITH: ${regUrl}`);
                node.log('═══════════════════════════════════════');
                
                return true;
                
            } catch (error) {
                node.error(`Registration failed: ${error.message}`);
                if (!registryUrl) {
                    node.status({fill: "red", shape: "ring", text: "registration failed"});
                }
                if (registryUrl) {
                    discoveredRegistries.set(registryUrl, {
                        url: registryUrl,
                        apiVersion: apiVersion,
                        registered: false,
                        lastHeartbeat: Date.now(),
                        priority: 100
                    });
                }
                return false;
            }
        };
        
        const sendHeartbeat = async () => {
            try {
                if (!registrationComplete) {
                    return;
                }
                
                // Send heartbeat to configured registry
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = node.registry.getAuthHeaders();
                
                const response = await axios.post(
                    `${registrationApiUrl}/health/nodes/${node.nodeId}`,
                    {},
                    {
                        headers,
                        timeout: 5000,
                        validateStatus: (status) => status >= 200 && status < 500
                    }
                );
                
                if (response.status === 200) {
                    node.log('♥ Heartbeat OK (configured registry)');
                } else if (response.status === 404) {
                    node.warn('Heartbeat returned 404 - re-registering (configured registry)');
                    registrationComplete = false;
                    await registerWithRegistry();
                } else {
                    node.warn(`Heartbeat returned status: ${response.status} (configured registry)`);
                }
                
            } catch (error) {
                node.warn(`Heartbeat failed (configured registry): ${error.message}`);
                registrationComplete = false;
                setTimeout(() => registerWithRegistry(), 1000);
            }
        };
        
        const sendHeartbeats = async () => {
            try {
                // Send heartbeat to configured registry
                await sendHeartbeat();
                
                // Send heartbeats to all discovered registries
                const heartbeatPromises = [];
                for (const [url, info] of discoveredRegistries) {
                    if (info.registered) {
                        heartbeatPromises.push(
                            axios.post(
                                `${url}/health/nodes/${node.nodeId}`,
                                {},
                                {
                                    headers: node.registry.getAuthHeaders(),
                                    timeout: 5000,
                                    validateStatus: (status) => status >= 200 && status < 500
                                }
                            ).then(response => {
                                if (response.status === 200) {
                                    info.lastHeartbeat = Date.now();
                                    node.log(`♥ Heartbeat OK: ${url}`);
                                } else if (response.status === 404) {
                                    node.warn(`Heartbeat 404 for ${url} - re-registering`);
                                    info.registered = false;
                                    registerWithRegistry(url, info.apiVersion);
                                } else {
                                    node.warn(`Heartbeat ${response.status} for ${url}`);
                                }
                                return { url, status: 'success' };
                            }).catch(error => {
                                node.warn(`Heartbeat failed for ${url}: ${error.message}`);
                                info.registered = false;
                                return { url, status: 'error', error: error.message };
                            })
                        );
                    }
                }
                
                await Promise.allSettled(heartbeatPromises);
                
            } catch (error) {
                node.warn(`Heartbeats error: ${error.message}`);
            }
        };
        
        const updateReceiverInRegistry = async () => {
            try {
                if (!registrationComplete) {
                    return;
                }
                
                const receiverResource = buildReceiverResource();
                
                // Update in configured registry
                await registerResource('receiver', receiverResource);
                
                // Update in all discovered registries
                for (const [url, info] of discoveredRegistries) {
                    if (info.registered) {
                        await registerResource('receiver', receiverResource, url);
                    }
                }
                
                node.log('Updated receiver subscription in all registries');
                
            } catch (error) {
                node.warn(`Failed to update receiver: ${error.message}`);
            }
        };
        
        const unregisterFromRegistry = async () => {
            try {
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = node.registry.getAuthHeaders();
                
                node.log('Unregistering from NMOS registry...');
                
                await axios.delete(
                    `${registrationApiUrl}/resource/receivers/${node.receiverId}`,
                    { headers, timeout: 5000 }
                ).catch(err => node.log(`Receiver delete: ${err.message}`));
                
                await axios.delete(
                    `${registrationApiUrl}/resource/devices/${node.deviceId}`,
                    { headers, timeout: 5000 }
                ).catch(err => node.log(`Device delete: ${err.message}`));
                
                await axios.delete(
                    `${registrationApiUrl}/resource/nodes/${node.nodeId}`,
                    { headers, timeout: 5000 }
                ).catch(err => node.log(`Node delete: ${err.message}`));
                
                // Unregister from discovered registries
                for (const [url, info] of discoveredRegistries) {
                    if (info.registered) {
                        await axios.delete(
                            `${url}/resource/receivers/${node.receiverId}`,
                            { headers, timeout: 5000 }
                        ).catch(() => {});
                        await axios.delete(
                            `${url}/resource/devices/${node.deviceId}`,
                            { headers, timeout: 5000 }
                        ).catch(() => {});
                        await axios.delete(
                            `${url}/resource/nodes/${node.nodeId}`,
                            { headers, timeout: 5000 }
                        ).catch(() => {});
                    }
                }
                
                node.log('✓ Unregistered from NMOS registry');
                
            } catch (error) {
                node.warn(`Unregistration error: ${error.message}`);
            }
        };
        
        const setupNodeAPI = () => {
            const app = RED.httpNode || RED.httpAdmin;
            const apiVersion = node.registry.queryApiVersion;
            const basePath = `/x-nmos/node/${apiVersion}`;
            
            node.log(`Setting up IS-04 Node API at: ${basePath}`);
            
            const jsonMiddleware = (req, res, next) => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                next();
            };
            
            // Root endpoint
            app.get(`${basePath}/`, jsonMiddleware, (req, res) => {
                res.status(200).json([
                    'self/',
                    'devices/',
                    'sources/',
                    'flows/',
                    'senders/',
                    'receivers/'
                ]);
            });
            
            // Self endpoint - returns node resource
            app.get(`${basePath}/self/`, jsonMiddleware, (req, res) => {
                res.status(200).json(buildNodeResource());
            });
            
            // Devices endpoints
            app.get(`${basePath}/devices/`, jsonMiddleware, (req, res) => {
                res.status(200).json([buildDeviceResource()]);
            });
            
            app.get(`${basePath}/devices/:deviceId`, jsonMiddleware, (req, res) => {
                const deviceId = req.params.deviceId;
                if (deviceId === node.deviceId) {
                    res.status(200).json(buildDeviceResource());
                } else {
                    res.status(404).json({
                        code: 404,
                        error: "Device not found",
                        debug: `Device ${deviceId} does not exist`
                    });
                }
            });
            
            // Receivers endpoints
            app.get(`${basePath}/receivers/`, jsonMiddleware, (req, res) => {
                res.status(200).json([buildReceiverResource()]);
            });
            
            app.get(`${basePath}/receivers/:receiverId`, jsonMiddleware, (req, res) => {
                const receiverId = req.params.receiverId;
                if (receiverId === node.receiverId) {
                    res.status(200).json(buildReceiverResource());
                } else {
                    res.status(404).json({
                        code: 404,
                        error: "Receiver not found",
                        debug: `Receiver ${receiverId} does not exist`
                    });
                }
            });
            
            // Empty arrays for sources, flows, senders
            app.get(`${basePath}/sources/`, jsonMiddleware, (req, res) => {
                res.status(200).json([]);
            });
            
            app.get(`${basePath}/flows/`, jsonMiddleware, (req, res) => {
                res.status(200).json([]);
            });
            
            app.get(`${basePath}/senders/`, jsonMiddleware, (req, res) => {
                res.status(200).json([]);
            });
            
            // 404 handler for Node API - must be after all valid routes
            app.use(`${basePath}/*`, (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                res.status(404).json({
                    code: 404,
                    error: "Not Found",
                    debug: `Path ${req.path} not found in Node API`
                });
            });
            
            node.log(`✓ IS-04 Node API ready`);
        };
        
        const setupTestingFacade = () => {
            const app = RED.httpNode || RED.httpAdmin;
            const basePath = '/x-nmos/testquestion/v1.0';
            
            node.log(`Setting up Testing Facade at: ${basePath}`);
            
            const jsonMiddleware = (req, res, next) => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                next();
            };
            
            app.post(`${basePath}/`, jsonMiddleware, async (req, res) => {
                try {
                    const question = req.body.question || '';
                    const timestamp = getTAITimestamp();
                    
                    node.log(`Testing Facade question: ${question}`);
                    
                    // Parse "Can you access the Query API at {url}?" question
                    if (question.includes('Can you access') && question.includes('Query API')) {
                        const urlMatch = question.match(/http[s]?:\/\/[^\s?]+/);
                        if (urlMatch) {
                            const queryUrl = urlMatch[0];
                            try {
                                const response = await axios.get(queryUrl, { 
                                    timeout: 5000,
                                    validateStatus: (status) => status >= 200 && status < 500
                                });
                                return res.status(200).json({
                                    status: 'success',
                                    answer: 'Yes, Query API is accessible',
                                    data: response.data,
                                    timestamp
                                });
                            } catch (err) {
                                return res.status(200).json({
                                    status: 'error',
                                    answer: 'Cannot access Query API',
                                    error: err.message,
                                    timestamp
                                });
                            }
                        }
                    }
                    
                    // Parse "What senders are available?" question
                    if (question.includes('What senders')) {
                        return res.status(200).json({
                            status: 'success',
                            answer: [],
                            timestamp
                        });
                    }
                    
                    // Parse "What receivers are available?" question
                    if (question.includes('What receivers')) {
                        return res.status(200).json({
                            status: 'success',
                            answer: [node.receiverId],
                            timestamp
                        });
                    }
                    
                    // Parse "Put receiver online/offline" question
                    if (question.includes('Put receiver') && (question.includes('online') || question.includes('offline'))) {
                        const online = question.includes('online');
                        receiverState.staged.master_enable = online;
                        receiverState.active.master_enable = online;
                        
                        await updateReceiverInRegistry();
                        
                        return res.status(200).json({
                            status: 'success',
                            answer: online ? 'Receiver put online' : 'Receiver put offline',
                            timestamp
                        });
                    }
                    
                    // Default response for unrecognized questions
                    res.status(200).json({
                        status: 'ok',
                        message: 'Test question received',
                        question: question,
                        timestamp
                    });
                    
                } catch (err) {
                    res.status(500).json({
                        status: 'error',
                        error: err.message,
                        timestamp: getTAITimestamp()
                    });
                }
            });
            
            node.log(`✓ Testing Facade ready`);
        };
        
        const startDNSSDDiscovery = () => {
            try {
                node.log('Starting DNS-SD discovery for NMOS registries...');
                
                // Browse for NMOS registration services
                mdnsBrowser = bonjour.find({ type: 'nmos-register', protocol: 'tcp' }, (service) => {
                    try {
                        node.log(`═══════════════════════════════════════`);
                        node.log(`Discovered NMOS Registry via DNS-SD:`);
                        node.log(`  Name: ${service.name}`);
                        node.log(`  Host: ${service.host}`);
                        node.log(`  Port: ${service.port}`);
                        node.log(`  Addresses: ${JSON.stringify(service.addresses)}`);
                        node.log(`═══════════════════════════════════════`);
                        
                        // Extract API version from TXT records if available
                        let apiVersion = node.registry.queryApiVersion;
                        if (service.txt && service.txt.api_ver) {
                            apiVersion = service.txt.api_ver;
                        }
                        
                        // Use the first address or fall back to host
                        const host = (service.addresses && service.addresses.length > 0) 
                            ? service.addresses[0] 
                            : service.host;
                        const port = service.port || 8080;
                        
                        // Build registration URL
                        const registryUrl = `http://${host}:${port}/x-nmos/registration/${apiVersion}`;
                        
                        // Check if we already have this registry
                        if (!discoveredRegistries.has(registryUrl)) {
                            node.log(`New registry discovered: ${registryUrl}`);
                            
                            // Add to discovered registries and attempt registration
                            discoveredRegistries.set(registryUrl, {
                                url: registryUrl,
                                apiVersion: apiVersion,
                                registered: false,
                                lastHeartbeat: Date.now(),
                                priority: service.txt && service.txt.pri ? parseInt(service.txt.pri, 10) : 100
                            });
                            
                            // Register with this registry
                            registerWithRegistry(registryUrl, apiVersion).catch(err => {
                                node.warn(`Failed to register with discovered registry ${registryUrl}: ${err.message}`);
                            });
                        }
                    } catch (error) {
                        node.warn(`Error processing discovered service: ${error.message}`);
                    }
                });
                
                node.log('✓ DNS-SD discovery started');
                
            } catch (error) {
                node.warn(`DNS-SD discovery error: ${error.message}`);
                node.log('Continuing without DNS-SD discovery');
            }
        };
        
        const setupConnectionAPI = () => {
            const app = RED.httpNode || RED.httpAdmin;
            const version = node.registry.connectionApiVersion;
            const apiRoot = `/x-nmos/connection/${version}`;
            const basePath = `${apiRoot}/single/receivers/${node.receiverId}`;
            
            node.log(`Setting up IS-05 endpoints at: ${basePath}`);
            
            const middleware = (req, res, next) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                
                // Override res.json to ensure Content-Type doesn't include charset
                const originalJson = res.json.bind(res);
                res.json = function(data) {
                    res.setHeader('Content-Type', 'application/json');
                    return originalJson(data);
                };
                
                if (req.method === 'OPTIONS') {
                    res.sendStatus(200);
                    return;
                }
                next();
            };
            
            // GET /x-nmos/connection/{version}/ - Return API root with available endpoints
            app.get(`${apiRoot}/`, middleware, (req, res) => {
                node.log(`GET ${apiRoot}/`);
                res.json(['single/']);
            });
            
            // GET /x-nmos/connection/{version}/single/ - Return available single resources
            app.get(`${apiRoot}/single/`, middleware, (req, res) => {
                node.log(`GET ${apiRoot}/single/`);
                res.json(['receivers/']);
            });
            
            // GET /x-nmos/connection/{version}/single/receivers/ - Return list of receiver IDs
            app.get(`${apiRoot}/single/receivers/`, middleware, (req, res) => {
                node.log(`GET ${apiRoot}/single/receivers/`);
                res.json([`${node.receiverId}/`]);
            });
            
            app.get(`${basePath}/staged`, middleware, (req, res) => {
                node.log('GET /staged');
                res.json(receiverState.staged);
            });
            
            app.patch(`${basePath}/staged`, middleware, (req, res) => {
                try {
                    node.log(`PATCH /staged: ${JSON.stringify(req.body, null, 2)}`);
                    const patch = req.body;
                    
                    if (patch.sender_id !== undefined) {
                        receiverState.staged.sender_id = patch.sender_id;
                    }
                    if (patch.master_enable !== undefined) {
                        receiverState.staged.master_enable = patch.master_enable;
                    }
                    if (patch.activation !== undefined) {
                        receiverState.staged.activation = {
                            ...receiverState.staged.activation,
                            ...patch.activation
                        };
                    }
                    if (patch.transport_params !== undefined) {
                        receiverState.staged.transport_params = patch.transport_params;
                    }
                    if (patch.transport_file !== undefined) {
                        receiverState.staged.transport_file = patch.transport_file;
                    }
                    
                    if (patch.activation && patch.activation.mode === 'activate_immediate') {
                        receiverState.active = JSON.parse(JSON.stringify(receiverState.staged));
                        receiverState.active.activation.activation_time = getTAITimestamp();
                        
                        if (!receiverState.active.transport_file.data && receiverState.active.sender_id) {
                            receiverState.active.transport_file = {
                                data: generateDefaultSDP(),
                                type: 'application/sdp'
                            };
                        }
                        
                        node.log(`✓ Connection activated: ${receiverState.active.sender_id}`);
                        
                        updateReceiverInRegistry();
                        
                        const msg = {
                            payload: {
                                event: 'connection_activated',
                                sender_id: receiverState.active.sender_id,
                                master_enable: receiverState.active.master_enable,
                                transport_params: receiverState.active.transport_params,
                                transport_file: receiverState.active.transport_file,
                                activation_time: receiverState.active.activation.activation_time,
                                sdp: receiverState.active.transport_file.data
                            },
                            receiverId: node.receiverId,
                            topic: 'connection'
                        };
                        node.send(msg);
                        
                        const isConnected = receiverState.active.sender_id !== null && receiverState.active.master_enable;
                        node.status({
                            fill: isConnected ? "green" : "yellow",
                            shape: "dot",
                            text: isConnected ? `connected: ${receiverState.active.sender_id.substring(0, 8)}...` : "standby"
                        });
                    }
                    
                    res.json(receiverState.staged);
                    
                } catch (error) {
                    node.error(`PATCH error: ${error.message}`);
                    res.status(400).json({
                        code: 400,
                        error: error.message,
                        debug: error.stack
                    });
                }
            });
            
            app.get(`${basePath}/active`, middleware, (req, res) => {
                node.log('GET /active');
                res.json(receiverState.active);
            });
            
            app.get(`${basePath}/constraints`, middleware, (req, res) => {
                node.log('GET /constraints');
                res.json(receiverState.constraints);
            });
            
            app.get(`${basePath}/transporttype`, middleware, (req, res) => {
                node.log('GET /transporttype');
                res.json(receiverState.transporttype);
            });
            
            node.log(`✓ IS-05 API ready: ${connectionAPIBase}/single/receivers/${node.receiverId}`);
        };
        
        setupNodeAPI();
        setupTestingFacade();
        setupConnectionAPI();
        startDNSSDDiscovery();
        
        registerWithRegistry().then(success => {
            if (success) {
                node.log('Starting heartbeat (5s interval)');
                heartbeatInterval = setInterval(() => sendHeartbeats(), 5000);
                setTimeout(() => sendHeartbeats(), 1000);
            } else {
                node.log('Registration failed, retry in 10s');
                setTimeout(() => registerWithRegistry(), 10000);
            }
        });
        
        node.on('input', function(msg) {
            if (msg.payload && msg.payload.action) {
                switch (msg.payload.action) {
                    case 'get_state':
                        msg.payload = {
                            nodeId: node.nodeId,
                            deviceId: node.deviceId,
                            receiverId: node.receiverId,
                            registered: registrationComplete,
                            state: receiverState,
                            connectionAPI: `${connectionAPIBase}/single/receivers/${node.receiverId}`,
                            localIP: localIP,
                            localMAC: localMAC,
                            interface: ifaceName,
                            registrationURL: getRegistrationApiUrl()
                        };
                        node.send(msg);
                        break;
                        
                    case 'disconnect':
                        receiverState.staged.sender_id = null;
                        receiverState.staged.master_enable = false;
                        receiverState.active = JSON.parse(JSON.stringify(receiverState.staged));
                        receiverState.active.transport_file = { data: null, type: null };
                        
                        updateReceiverInRegistry();
                        node.status({fill: "yellow", shape: "ring", text: "disconnected"});
                        
                        msg.payload = {
                            event: 'disconnected',
                            receiverId: node.receiverId
                        };
                        node.send(msg);
                        break;
                        
                    case 're-register':
                        node.log('Manual re-registration requested');
                        registerWithRegistry();
                        break;
                        
                    default:
                        node.warn('Unknown action: ' + msg.payload.action);
                }
            }
        });
        
        node.on('close', function(done) {
            node.log('Shutting down...');
            
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            
            if (mdnsBrowser) {
                try {
                    mdnsBrowser.stop();
                    bonjour.destroy();
                } catch (err) {
                    node.log(`DNS-SD cleanup error: ${err.message}`);
                }
            }
            
            unregisterFromRegistry().then(() => {
                node.status({});
                done();
            }).catch(() => done());
        });
    }
    
    RED.nodes.registerType("nmos-node", NMOSNodeNode);
};