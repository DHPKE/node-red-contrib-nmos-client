/**
 * nodes/nmos-is07-sender.js
 * NMOS IS-07 Sender - Complete implementation with MQTT and WebSocket transport support
 */

const mqtt = require('mqtt');
const WebSocket = require('ws');
const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

module.exports = function(RED) {
    function NMOSIS07SenderNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.registry = RED.nodes.getNode(config.registry);
        node.transportType = config.transportType || 'mqtt';
        node.mqttBroker = config.mqttBroker || 'mqtt://localhost:1883';
        node.mqttQos = parseInt(config.mqttQos) || 0;
        node.wsPort = parseInt(config.wsPort) || 3002;
        node.httpPort = parseInt(config.httpPort) || 1880;
        node.deviceLabel = config.deviceLabel || 'Node-RED IS-07 Sender';
        node.deviceDescription = config.deviceDescription || 'IS-07 Event Sender';
        node.senderLabel = config.senderLabel || 'Event Sender';
        node.sourceLabel = config.sourceLabel || 'Event Source';
        node.flowLabel = config.flowLabel || 'Event Flow';
        node.eventType = config.eventType || 'boolean';
        node.targetReceiverId = config.targetReceiverId || null;
        
        // Resource IDs
        node.nodeId = config.nodeId || uuidv4();
        node.deviceId = config.deviceId || uuidv4();
        node.sourceId = config.sourceId || uuidv4();
        node.flowId = config.flowId || uuidv4();
        node.senderId = config.senderId || uuidv4();

        let mqttClient = null;
        let wss = null;
        let wsConnections = new Set();
        let registrationComplete = false;
        let heartbeatInterval = null;
        let httpEndpoints = [];

        // Validate configuration
        if (!node.registry) {
            node.error('No NMOS registry configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            return;
        }

        if ((node.transportType === 'mqtt' || node.transportType === 'both') && !node.mqttBroker) {
            node.error('No MQTT broker configured for MQTT transport');
            node.status({ fill: 'red', shape: 'ring', text: 'no mqtt broker' });
            return;
        }

        if ((node.transportType === 'websocket' || node.transportType === 'both') && !node.wsPort) {
            node.error('No WebSocket port configured for WebSocket transport');
            node.status({ fill: 'red', shape: 'ring', text: 'no ws port' });
            return;
        }

        // ============================================================================
        // Utility Functions
        // ============================================================================

        const getNetworkInfo = () => {
            const interfaces = os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        return {
                            ip: iface.address,
                            mac: iface.mac ? iface.mac.replace(/:/g, '-') : '00-00-00-00-00-00',
                            name
                        };
                    }
                }
            }
            return { ip: '127.0.0.1', mac: '00-00-00-00-00-00', name: 'lo' };
        };

        const net = getNetworkInfo();
        const localIP = net.ip;
        const localMAC = net.mac;
        const ifaceName = net.name;

        /**
         * Get TAI timestamp (International Atomic Time)
         * Format: seconds:nanoseconds
         */
        const getTAITimestamp = () => {
            const now = Date.now() / 1000;
            const taiSeconds = Math.floor(now) + 37; // TAI = UTC + 37 seconds
            const taiNanoseconds = Math.floor((now % 1) * 1e9);
            return `${taiSeconds}:${String(taiNanoseconds).padStart(9, '0')}`;
        };

        const getRegistrationApiUrl = () => {
            return `${node.registry.registryUrl}/x-nmos/registration/${node.registry.queryApiVersion}`;
        };

        /**
         * Get event type URN
         */
        const getEventTypeURN = () => {
            return `urn:x-nmos:event_type:${node.eventType}/v1.0`;
        };

        /**
         * Get transport URN based on transport type
         */
        const getTransportURN = () => {
            if (node.transportType === 'mqtt') {
                return 'urn:x-nmos:transport:mqtt';
            } else if (node.transportType === 'websocket') {
                return 'urn:x-nmos:transport:websocket';
            } else {
                // For 'both', we use MQTT as primary
                return 'urn:x-nmos:transport:mqtt';
            }
        };

        /**
         * Get MQTT topic for this source
         */
        const getMQTTTopic = () => {
            return `x-nmos/events/1.0/${node.sourceId}/${node.eventType}`;
        };

        /**
         * Get WebSocket endpoint path
         */
        const getWebSocketPath = () => {
            return `/x-nmos/events/1.0/${node.sourceId}/${node.eventType}`;
        };

        // ============================================================================
        // IS-04 Resource Builders
        // ============================================================================

        const buildNodeResource = () => {
            const resource = {
                id: node.nodeId,
                version: getTAITimestamp(),
                label: `${node.deviceLabel} Node`,
                description: node.deviceDescription,
                href: `http://${localIP}:${node.httpPort}/`,
                hostname: os.hostname(),
                caps: {},
                tags: {},
                api: {
                    versions: [node.registry.queryApiVersion],
                    endpoints: [{
                        host: localIP,
                        port: node.httpPort,
                        protocol: 'http'
                    }]
                },
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

            if (node.registry.queryApiVersion >= 'v1.1') {
                resource.services = [];
            }

            return resource;
        };

        const buildDeviceResource = () => {
            const resource = {
                id: node.deviceId,
                version: getTAITimestamp(),
                label: node.deviceLabel,
                description: node.deviceDescription,
                type: 'urn:x-nmos:device:generic',
                node_id: node.nodeId,
                senders: [node.senderId],
                receivers: [],
                tags: {}
            };

            // Add IS-05 Connection API control
            if (node.registry.queryApiVersion >= 'v1.1') {
                resource.controls = [{
                    type: 'urn:x-nmos:control:sr-ctrl/v1.1',
                    href: `http://${localIP}:${node.httpPort}/x-nmos/connection/v1.1/`
                }];
            }

            return resource;
        };

        const buildSourceResource = () => {
            const resource = {
                id: node.sourceId,
                version: getTAITimestamp(),
                label: node.sourceLabel,
                description: `IS-07 Event Source (${node.eventType})`,
                format: 'urn:x-nmos:format:data',
                caps: {},
                tags: {},
                device_id: node.deviceId,
                parents: [],
                clock_name: 'clk0'
            };

            resource.tags['urn:x-nmos:tag:is07/event_type'] = [node.eventType];

            return resource;
        };

        const buildFlowResource = () => {
            const resource = {
                id: node.flowId,
                version: getTAITimestamp(),
                label: node.flowLabel,
                description: `IS-07 Event Flow (${node.eventType})`,
                format: 'urn:x-nmos:format:data',
                tags: {},
                source_id: node.sourceId,
                device_id: node.deviceId,
                parents: []
            };

            if (node.registry.queryApiVersion >= 'v1.1') {
                resource.grain_rate = {
                    numerator: 0,
                    denominator: 1
                };
            }

            resource.media_type = 'application/json';
            resource.tags['urn:x-nmos:tag:is07/event_type'] = [node.eventType];

            return resource;
        };

        const buildSenderResource = () => {
    const { ip, name: ifaceName } = getNetworkInfo();
    
    // Set transport URN based on configuration
    let transport;
    if (node.transportType === 'mqtt') {
        transport = 'urn:x-nmos:transport:mqtt';
    } else if (node.transportType === 'websocket') {
        transport = 'urn:x-nmos:transport:websocket';
    } else {
        transport = 'urn:x-nmos:transport:mqtt'; // Default for 'both'
    }
    
    const resource = {
        id: node.senderId,
        version: getTAITimestamp(),
        label: node.senderLabel,
        description: `IS-07 Event Sender - ${node.senderLabel}`,
        flow_id: node.flowId,
        transport: transport,  // ← CRITICAL: Must be present!
        tags: {},
        device_id: node.deviceId,
        manifest_href: `http://${ip}:${node.httpPort || 1880}/x-nmos/events/sources/${node.sourceId}/manifest`,
        interface_bindings: [ifaceName],
        subscription: {
            receiver_id: null,
            active: false
        }
    };
    return resource;
};

            // Build manifest_href
            resource.manifest_href = `http://${localIP}:${node.httpPort}/x-nmos/events/sources/${node.sourceId}/manifest`;

            return resource;
        };

        // ============================================================================
        // IS-07 Manifest Builder
        // ============================================================================

        function buildManifest() {
            const eventTypeUrn = `urn:x-nmos:event_type:${node.eventType}/v1.0`;
    
            return {
        id: node.sourceId,
        label: node.sourceLabel,
        description: `IS-07 Event Source - ${node.eventType}`,
        tags: {},
        state: {
            event_type: eventTypeUrn,
            description: `State type`
        },
        events: [{
            event_type: eventTypeUrn,
            description: `Event type`
        }]
            };
        }

        // ============================================================================
        // IS-05 Connection API State
        // ============================================================================

        let connectionState = {
            staged: {
                transport_params: [],
                activation: {
                    mode: 'activate_immediate',
                    requested_time: null
                }
            },
            active: {
                transport_params: [],
                activation: {
                    mode: null,
                    requested_time: null
                }
            },
            constraints: []
        };

        // Initialize transport parameters based on transport type
        const initializeConnectionState = () => {
            const params = [];

            if (node.transportType === 'mqtt' || node.transportType === 'both') {
                params.push({
                    broker_topic: getMQTTTopic(),
                    connection_uri: node.mqttBroker,
                    connection_authorization: false
                });
            }

            if (node.transportType === 'websocket' || node.transportType === 'both') {
                params.push({
                    connection_uri: `ws://${localIP}:${node.wsPort}${getWebSocketPath()}`,
                    connection_authorization: false
                });
            }

            connectionState.staged.transport_params = params;
            connectionState.active.transport_params = JSON.parse(JSON.stringify(params));
        };

        initializeConnectionState();

        // ============================================================================
        // IS-04 Registration
        // ============================================================================

        async function registerResource(type, data) {
            const registrationApiUrl = getRegistrationApiUrl();
            const headers = { 
                ...node.registry.getAuthHeaders(), 
                'Content-Type': 'application/json' 
            };
            const payload = { type, data };

            try {
                node.log(`Registering ${type}: ${data.id}`);

                const res = await axios.post(`${registrationApiUrl}/resource`, payload, {
                    headers,
                    timeout: 10000,
                    validateStatus: s => s < 500
                });

                if (res.status === 200 || res.status === 201) {
                    node.log(`✓ Registered ${type}: ${data.id}`);
                    return true;
                } else {
                    node.error(`Registration failed ${type}: HTTP ${res.status}`);
                    node.error(`Response: ${JSON.stringify(res.data, null, 2)}`);
                    return false;
                }
            } catch (err) {
                if (err.response) {
                    node.error(`Registration error ${type}: HTTP ${err.response.status}`);
                    node.error(`Response: ${JSON.stringify(err.response.data, null, 2)}`);
                } else {
                    node.error(`Registration error ${type}: ${err.message}`);
                }
                return false;
            }
        }

        async function registerAll() {
            node.status({ fill: 'blue', shape: 'dot', text: 'registering...' });
            
            try {
                node.log('═══════════════════════════════════════');
                node.log('Starting IS-07 Sender Registration');
                node.log(`Registry: ${getRegistrationApiUrl()}`);
                node.log(`Transport: ${node.transportType}`);
                node.log('═══════════════════════════════════════');

                // Step 1: Register Node
                const ok1 = await registerResource('node', buildNodeResource());
                if (!ok1) throw new Error('Node registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Step 2: Register Device
                const ok2 = await registerResource('device', buildDeviceResource());
                if (!ok2) throw new Error('Device registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Step 3: Register Source
                const ok3 = await registerResource('source', buildSourceResource());
                if (!ok3) throw new Error('Source registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Step 4: Register Flow
                const ok4 = await registerResource('flow', buildFlowResource());
                if (!ok4) throw new Error('Flow registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Step 5: Register Sender
                const ok5 = await registerResource('sender', buildSenderResource());
                if (!ok5) throw new Error('Sender registration failed');

                registrationComplete = true;
                updateStatus();
                node.log('═══════════════════════════════════════');
                node.log('✓ ALL IS-07 SENDER RESOURCES REGISTERED');
                node.log('═══════════════════════════════════════');
                return true;

            } catch (err) {
                registrationComplete = false;
                node.status({ fill: 'red', shape: 'ring', text: 'registration failed' });
                node.error(`Registration failed: ${err.message}`);
                node.log('═══════════════════════════════════════');
                return false;
            }
        }

        async function sendHeartbeat() {
            if (!registrationComplete) return;
            
            try {
                const url = `${getRegistrationApiUrl()}/health/nodes/${node.nodeId}`;
                const headers = node.registry.getAuthHeaders();
                const res = await axios.post(url, {}, { 
                    headers, 
                    timeout: 5000, 
                    validateStatus: s => s < 500 
                });

                if (res.status === 200) {
                    node.log('♥ Heartbeat OK');
                } else if (res.status === 404) {
                    node.warn('Registration lost (404), re-registering...');
                    registrationComplete = false;
                    await registerAll();
                } else {
                    node.warn(`Heartbeat unexpected status: ${res.status}`);
                }
            } catch (err) {
                node.warn(`Heartbeat error: ${err.message}`);
            }
        }

        // ============================================================================
        // IS-07 Grain Building
        // ============================================================================

        const buildGrain = (payload) => {
            const timestamp = getTAITimestamp();
            const topic = getMQTTTopic();

            return {
                grain_type: 'event',
                source_id: node.sourceId,
                flow_id: node.flowId,
                origin_timestamp: timestamp,
                sync_timestamp: timestamp,
                creation_timestamp: timestamp,
                rate: { numerator: 0, denominator: 1 },
                duration: { numerator: 0, denominator: 1 },
                grain: {
                    type: 'urn:x-nmos:format:data.event',
                    topic: topic,
                    data: Array.isArray(payload) ? payload : [payload]
                }
            };
        };

        // ============================================================================
        // MQTT Transport
        // ============================================================================

        function setupMQTTClient() {
            if (node.transportType !== 'mqtt' && node.transportType !== 'both') {
                return;
            }

            const topic = getMQTTTopic();

            node.log(`Connecting MQTT: ${node.mqttBroker}`);
            node.log(`Publish topic: ${topic}`);

            mqttClient = mqtt.connect(node.mqttBroker, {
                clientId: `nmos-is07-sender-${node.senderId}`,
                clean: true,
                reconnectPeriod: 5000
            });

            mqttClient.on('connect', () => {
                node.log('✓ MQTT connected');
                updateStatus();
            });

            mqttClient.on('error', (err) => {
                node.error(`MQTT error: ${err.message}`);
                updateStatus();
            });

            mqttClient.on('offline', () => {
                node.warn('MQTT offline');
                updateStatus();
            });

            mqttClient.on('reconnect', () => {
                node.log('MQTT reconnecting...');
            });
        }

        function publishToMQTT(grain) {
            if (!mqttClient || !mqttClient.connected) {
                node.warn('Cannot publish: MQTT not connected');
                return false;
            }

            const topic = getMQTTTopic();

            mqttClient.publish(topic, JSON.stringify(grain), {
                qos: node.mqttQos,
                retain: false
            }, (err) => {
                if (err) {
                    node.error(`MQTT publish error: ${err.message}`);
                } else {
                    node.log(`► Published to MQTT: ${topic}`);
                }
            });

            return true;
        }

        // ============================================================================
        // WebSocket Transport
        // ============================================================================

        function setupWebSocketServer() {
            if (node.transportType !== 'websocket' && node.transportType !== 'both') {
                return;
            }

            const wsPath = getWebSocketPath();

            node.log(`Starting WebSocket server on port ${node.wsPort}`);
            node.log(`WebSocket path: ${wsPath}`);

            try {
                wss = new WebSocket.Server({ 
                    port: node.wsPort,
                    path: wsPath
                });
                
                wss.on('listening', () => {
                    node.log(`✓ WebSocket server listening on port ${node.wsPort}`);
                    updateStatus();
                });
                
                wss.on('connection', (ws) => {
                    wsConnections.add(ws);
                    node.log(`✓ WebSocket client connected (${wsConnections.size} total)`);
                    updateStatus();
                    
                    ws.on('close', () => {
                        wsConnections.delete(ws);
                        node.log(`WebSocket client disconnected (${wsConnections.size} remaining)`);
                        updateStatus();
                    });
                    
                    ws.on('error', (error) => {
                        node.error(`WebSocket client error: ${error.message}`);
                    });
                });
                
                wss.on('error', (error) => {
                    if (error.code === 'EADDRINUSE') {
                        node.error(`Port ${node.wsPort} is already in use`);
                        node.status({ fill: 'red', shape: 'ring', text: 'port in use' });
                    } else {
                        node.error(`WebSocket server error: ${error.message}`);
                        updateStatus();
                    }
                });
            } catch (error) {
                node.error(`WebSocket setup failed: ${error.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'ws setup failed' });
            }
        }

        function publishToWebSocket(grain) {
            if (!wss || wsConnections.size === 0) {
                node.log('No WebSocket clients connected');
                return false;
            }

            const message = JSON.stringify(grain);
            let successCount = 0;

            wsConnections.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(message);
                        successCount++;
                    } catch (error) {
                        node.warn(`Failed to send to WebSocket client: ${error.message}`);
                    }
                }
            });

            if (successCount > 0) {
                node.log(`► Published to ${successCount} WebSocket client(s)`);
                return true;
            }

            return false;
        }

        // ============================================================================
        // IS-05 Connection API Endpoints
        // ============================================================================

        function setupConnectionAPI() {
            const baseUrl = '/x-nmos/connection/v1.1';

            // Root
            httpEndpoints.push(
                RED.httpNode.get(`${baseUrl}/`, (req, res) => {
                    res.json(['single/']);
                })
            );

            // Single root
            httpEndpoints.push(
                RED.httpNode.get(`${baseUrl}/single/`, (req, res) => {
                    res.json(['senders/']);
                })
            );

            // Senders list
            httpEndpoints.push(
                RED.httpNode.get(`${baseUrl}/single/senders/`, (req, res) => {
                    res.json([`${node.senderId}/`]);
                })
            );

            // Sender root
            httpEndpoints.push(
                RED.httpNode.get(`${baseUrl}/single/senders/${node.senderId}/`, (req, res) => {
                    res.json([
                        'constraints/',
                        'staged/',
                        'active/',
                        'transporttype/'
                    ]);
                })
            );

            // GET staged
            httpEndpoints.push(
                RED.httpNode.get(`${baseUrl}/single/senders/${node.senderId}/staged`, (req, res) => {
                    res.json(connectionState.staged);
                })
            );

            // PATCH staged
            httpEndpoints.push(
                RED.httpNode.patch(`${baseUrl}/single/senders/${node.senderId}/staged`, (req, res) => {
                    try {
                        const patch = req.body;

                        // Apply patch to staged state
                        if (patch.transport_params !== undefined) {
                            connectionState.staged.transport_params = patch.transport_params;
                        }
                        if (patch.activation !== undefined) {
                            connectionState.staged.activation = {
                                ...connectionState.staged.activation,
                                ...patch.activation
                            };
                        }

                        // Handle activation
                        if (connectionState.staged.activation.mode === 'activate_immediate') {
                            connectionState.active = JSON.parse(JSON.stringify(connectionState.staged));
                            node.log('Connection activated immediately');
                        }

                        res.json(connectionState.staged);
                    } catch (error) {
                        node.error(`PATCH staged error: ${error.message}`);
                        res.status(400).json({ error: error.message });
                    }
                })
            );

            // GET active
            httpEndpoints.push(
                RED.httpNode.get(`${baseUrl}/single/senders/${node.senderId}/active`, (req, res) => {
                    res.json(connectionState.active);
                })
            );

            // GET constraints
            httpEndpoints.push(
                RED.httpNode.get(`${baseUrl}/single/senders/${node.senderId}/constraints`, (req, res) => {
                    res.json(connectionState.constraints);
                })
            );

            // GET transporttype
            httpEndpoints.push(
                RED.httpNode.get(`${baseUrl}/single/senders/${node.senderId}/transporttype`, (req, res) => {
                    res.json(getTransportURN());
                })
            );

            node.log('✓ IS-05 Connection API endpoints registered');
        }

        // ============================================================================
        // IS-07 Manifest Endpoint
        // ============================================================================

        function setupManifestEndpoint() {
            const manifestPath = `/x-nmos/events/sources/${node.sourceId}/manifest`;
    
            RED.httpNode.get(manifestPath, (req, res) => {
        // Add CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        
        try {
            const manifest = buildManifest();
            res.status(200).json(manifest);
        } catch (err) {
            node.error(`Manifest error: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
            });
    
            node.log(`✓ Manifest at http://localhost:${node.httpPort}${manifestPath}`);

    

        // ============================================================================
        // Event Publishing
        // ============================================================================

        function publishEvent(payload) {
            const grain = buildGrain(payload);
            
            let published = false;

            // Publish to MQTT if enabled
            if (node.transportType === 'mqtt' || node.transportType === 'both') {
                if (publishToMQTT(grain)) {
                    published = true;
                }
            }

            // Publish to WebSocket if enabled
            if (node.transportType === 'websocket' || node.transportType === 'both') {
                if (publishToWebSocket(grain)) {
                    published = true;
                }
            }

            if (published) {
                node.status({ fill: 'blue', shape: 'dot', text: 'publishing' });
                setTimeout(() => updateStatus(), 500);
            }

            return published;
        }

        // ============================================================================
        // Status Management
        // ============================================================================

        function updateStatus() {
            if (!registrationComplete) {
                node.status({ fill: 'yellow', shape: 'dot', text: 'not registered' });
                return;
            }

            let statusText = 'ready';
            let statusColor = 'green';

            // Check transport status
            if (node.transportType === 'mqtt') {
                if (mqttClient && mqttClient.connected) {
                    statusText = 'mqtt ready';
                } else {
                    statusText = 'mqtt offline';
                    statusColor = 'yellow';
                }
            } else if (node.transportType === 'websocket') {
                if (wss) {
                    statusText = `ws ready (${wsConnections.size} clients)`;
                } else {
                    statusText = 'ws offline';
                    statusColor = 'yellow';
                }
            } else if (node.transportType === 'both') {
                const mqttOk = mqttClient && mqttClient.connected;
                const wsOk = wss !== null;
                
                if (mqttOk && wsOk) {
                    statusText = `ready (ws: ${wsConnections.size})`;
                } else if (mqttOk || wsOk) {
                    statusText = 'partial transport';
                    statusColor = 'yellow';
                } else {
                    statusText = 'transports offline';
                    statusColor = 'red';
                }
            }

            node.status({ fill: statusColor, shape: 'dot', text: statusText });
        }

        // ============================================================================
        // Node Input Handler
        // ============================================================================

        node.on('input', async (msg) => {
            try {
                const action = (msg.payload && msg.payload.action) || msg.action;

                if (action === 'get_state') {
                    msg.payload = {
                        nodeId: node.nodeId,
                        deviceId: node.deviceId,
                        sourceId: node.sourceId,
                        flowId: node.flowId,
                        senderId: node.senderId,
                        registered: registrationComplete,
                        transportType: node.transportType,
                        mqttConnected: mqttClient ? mqttClient.connected : false,
                        mqttBroker: node.mqttBroker,
                        mqttTopic: getMQTTTopic(),
                        wsPort: node.wsPort,
                        wsPath: getWebSocketPath(),
                        wsClients: wsConnections.size,
                        eventType: node.eventType,
                        manifestUrl: `http://${localIP}:${node.httpPort}/x-nmos/events/sources/${node.sourceId}/manifest`,
                        connectionApiUrl: `http://${localIP}:${node.httpPort}/x-nmos/connection/v1.1/`,
                        registrationUrl: getRegistrationApiUrl()
                    };
                    node.send(msg);
                } else if (action === 're-register') {
                    node.log('Manual re-registration requested');
                    await registerAll();
                } else {
                    // Default: publish payload as event
                    const payload = msg.payload;
                    if (publishEvent(payload)) {
                        node.log('✓ Event published');
                    } else {
                        node.warn('Event publish failed - no active transport');
                    }
                }
            } catch (err) {
                node.error(`Input error: ${err.message}`);
                msg.payload = { error: err.message };
                node.send(msg);
            }
        });

        // ============================================================================
        // Lifecycle - Initialization
        // ============================================================================

        async function initialize() {
            try {
                // Step 1: Setup transports
                setupMQTTClient();
                setupWebSocketServer();

                // Step 2: Setup HTTP endpoints
                setupConnectionAPI();
                setupManifestEndpoint();

                // Step 3: Register with IS-04
                const ok = await registerAll();
                if (ok) {
                    heartbeatInterval = setInterval(sendHeartbeat, 5000);
                    setTimeout(sendHeartbeat, 1000);
                } else {
                    node.warn('Initial registration failed, will retry in 10s');
                    setTimeout(initialize, 10000);
                }
            } catch (error) {
                node.error(`Initialization error: ${error.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'init failed' });
            }
        }

        // Start initialization
        initialize();

        // ============================================================================
        // Lifecycle - Cleanup
        // ============================================================================

        node.on('close', (done) => {
            node.log('Shutting down IS-07 Sender...');
            
            // Stop heartbeat
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            
            // Close MQTT
            if (mqttClient) {
                mqttClient.end(true);
            }

            // Close WebSocket connections
            wsConnections.forEach(ws => {
                try {
                    ws.close();
                } catch (e) {
                    // Ignore
                }
            });
            wsConnections.clear();

            // Close WebSocket server
            if (wss) {
                wss.close(() => {
                    node.log('✓ WebSocket server closed');
                });
            }

            // Remove HTTP endpoints
            httpEndpoints.forEach(endpoint => {
                try {
                    RED.httpNode._router.stack = RED.httpNode._router.stack.filter(r => r.route !== endpoint);
                } catch (e) {
                    // Ignore
                }
            });

            // Unregister IS-04 resources
            (async () => {
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = node.registry.getAuthHeaders();
                try {
                    await axios.delete(`${registrationApiUrl}/resource/senders/${node.senderId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/flows/${node.flowId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/sources/${node.sourceId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/devices/${node.deviceId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/nodes/${node.nodeId}`, { headers }).catch(() => {});
                    node.log('✓ Unregistered from IS-04');
                } catch (e) {
                    node.warn('Unregister error (normal on shutdown)');
                }
            })().finally(() => {
                done();
            });
        });
    }

    RED.nodes.registerType('nmos-is07-sender', NMOSIS07SenderNode);
};
