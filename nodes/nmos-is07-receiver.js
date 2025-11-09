/**
 * nodes/nmos-is07-receiver.js
 * NMOS IS-07 Receiver - Receive IS-07 event grains via MQTT and/or WebSocket
 * Supports IS-04 Registration, IS-05 Connection API
 */

const mqtt = require('mqtt');
const WebSocket = require('ws');
const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const url = require('url');

module.exports = function(RED) {
    function NMOSIS07ReceiverNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.registry = RED.nodes.getNode(config.registry);
        node.transportType = config.transportType || 'mqtt'; // mqtt, websocket, both
        node.mqttBroker = config.mqttBroker || 'mqtt://localhost:1883';
        node.mqttQos = parseInt(config.mqttQos) || 0;
        node.httpPort = parseInt(config.httpPort) || 1880;
        node.deviceLabel = config.deviceLabel || 'Node-RED IS-07 Receiver';
        node.deviceDescription = config.deviceDescription || 'IS-07 Receiver';
        node.receiverLabel = config.receiverLabel || 'Event Receiver';
        node.subscriptionFilter = config.subscriptionFilter || 'x-nmos/events/1.0/+/+';
        node.validateGrains = config.validateGrains !== false;
        node.outputFormat = config.outputFormat || 'data_only'; // data_only, full_grain, both
        
        // Resource IDs
        node.nodeId = config.nodeId || uuidv4();
        node.deviceId = config.deviceId || uuidv4();
        node.receiverId = config.receiverId || uuidv4();

        let mqttClient = null;
        let wsClients = new Map(); // Map of WebSocket connections
        let registrationComplete = false;
        let heartbeatInterval = null;
        let httpServer = null;
        let connectionApiRoutes = [];

        // Connection state for IS-05
        const connectionState = {
            staged: {
                sender_id: null,
                master_enable: true,
                activation: {
                    mode: null,
                    requested_time: null,
                    activation_time: null
                },
                transport_params: []
            },
            active: {
                sender_id: null,
                master_enable: true,
                activation: {
                    mode: null,
                    requested_time: null,
                    activation_time: null
                },
                transport_params: []
            }
        };

        // Validation
        if (!node.registry) {
            node.error('No NMOS registry configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            return;
        }

        if ((node.transportType === 'mqtt' || node.transportType === 'both') && !node.mqttBroker) {
            node.error('No MQTT broker configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no mqtt broker' });
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
         * Note: TAI offset was 37 seconds as of January 2017. This may need updating
         * when new leap seconds are added. See: https://www.ietf.org/timezones/data/leap-seconds.list
         */
        const getTAITimestamp = () => {
            const now = Date.now() / 1000;
            const taiSeconds = Math.floor(now) + 37; // TAI = UTC + 37 seconds (as of 2017)
            const taiNanoseconds = Math.floor((now % 1) * 1e9);
            return `${taiSeconds}:${String(taiNanoseconds).padStart(9, '0')}`;
        };

        const getRegistrationApiUrl = () => {
            return `${node.registry.registryUrl}/x-nmos/registration/${node.registry.queryApiVersion}`;
        };

        /**
         * Get transport URN based on configured transport type
         */
        const getTransportUrn = () => {
            if (node.transportType === 'mqtt') {
                return 'urn:x-nmos:transport:mqtt';
            } else if (node.transportType === 'websocket') {
                return 'urn:x-nmos:transport:websocket';
            } else {
                // both - return both URNs as array
                return ['urn:x-nmos:transport:mqtt', 'urn:x-nmos:transport:websocket'];
            }
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
                tags: {
                    'urn:x-nmos:tag:is07/role': ['receiver']
                },
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
                    chassis_id: localMAC,
                    port_id: localMAC,
                    name: ifaceName
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
                senders: [],
                receivers: [node.receiverId],
                tags: {
                    'urn:x-nmos:tag:is07/receiver': ['true'],
                    'urn:x-nmos:tag:is07/role': ['receiver']
                }
            };

            // Add IS-05 controls for v1.1+
            if (node.registry.queryApiVersion >= 'v1.1') {
                resource.controls = [{
                    type: 'urn:x-nmos:control:sr-ctrl/v1.1',
                    href: `http://${localIP}:${node.httpPort}/x-nmos/connection/v1.1/`
                }];
            }

            return resource;
        };

        const buildReceiverResource = () => {
            const transportUrn = getTransportUrn();
            
            const resource = {
                id: node.receiverId,
                version: getTAITimestamp(),
                label: node.receiverLabel,
                description: `IS-07 Event Receiver - ${node.receiverLabel}`,
                format: 'urn:x-nmos:format:data',
                caps: {
                    media_types: ['application/json']
                },
                tags: {
                    'urn:x-nmos:tag:is07/event_types': ['boolean', 'string', 'number', 'object'],
                    'urn:x-nmos:tag:is07/transport': Array.isArray(transportUrn) ? 
                        ['mqtt', 'websocket'] : 
                        [node.transportType]
                },
                device_id: node.deviceId,
                transport: Array.isArray(transportUrn) ? transportUrn[0] : transportUrn,
                interface_bindings: [ifaceName],
                subscription: {
                    sender_id: connectionState.active.sender_id,
                    active: connectionState.active.master_enable && connectionState.active.sender_id !== null
                }
            };

            return resource;
        };

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
                    return false;
                }
            } catch (err) {
                if (err.response) {
                    node.error(`Registration error ${type}: HTTP ${err.response.status}`);
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
                node.log('Starting IS-07 Receiver Registration');
                node.log(`Registry: ${getRegistrationApiUrl()}`);
                node.log('═══════════════════════════════════════');

                // Step 1: Register Node
                const ok1 = await registerResource('node', buildNodeResource());
                if (!ok1) {
                    throw new Error('Node registration failed');
                }
                await new Promise(r => setTimeout(r, 300));

                // Step 2: Register Device
                const ok2 = await registerResource('device', buildDeviceResource());
                if (!ok2) {
                    throw new Error('Device registration failed');
                }
                await new Promise(r => setTimeout(r, 300));

                // Step 3: Register Receiver
                const ok3 = await registerResource('receiver', buildReceiverResource());
                if (!ok3) {
                    throw new Error('Receiver registration failed');
                }

                registrationComplete = true;
                updateStatus();
                node.log('═══════════════════════════════════════');
                node.log('✓ ALL IS-07 RECEIVER RESOURCES REGISTERED');
                node.log('═══════════════════════════════════════');
                return true;
            } catch (err) {
                node.error(`Registration failed: ${err.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'registration failed' });
                return false;
            }
        }

        async function sendHeartbeat() {
            if (!registrationComplete) return;

            try {
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = { 
                    ...node.registry.getAuthHeaders(), 
                    'Content-Type': 'application/json' 
                };

                await axios.post(`${registrationApiUrl}/health/nodes/${node.nodeId}`, {}, {
                    headers,
                    timeout: 5000
                });
            } catch (err) {
                node.warn(`Heartbeat failed: ${err.message}`);
            }
        }

        // ============================================================================
        // Grain Validation and Parsing
        // ============================================================================

        /**
         * Validate IS-07 grain structure
         */
        const validateGrain = (grain) => {
            if (!grain) return false;
            
            // Required top-level fields
            if (!grain.grain_type || grain.grain_type !== 'event') return false;
            if (!grain.source_id) return false;
            if (!grain.flow_id) return false;
            if (!grain.origin_timestamp) return false;
            
            // Check grain payload
            if (!grain.grain || !grain.grain.type) return false;
            if (!grain.grain.data || !Array.isArray(grain.grain.data)) return false;
            
            return true;
        };

        /**
         * Parse IS-07 grain and extract event data
         */
        const parseGrain = (grain) => {
            if (node.validateGrains && !validateGrain(grain)) {
                node.warn('Invalid grain structure');
                return null;
            }

            const topic = grain.grain.topic || 'unknown';
            const data = grain.grain.data;
            
            // Extract event type from topic or grain
            let eventType = 'object';
            const topicMatch = topic.match(/\/([^/]+)$/);
            if (topicMatch) {
                eventType = topicMatch[1];
            }

            // Extract the actual event data
            let extractedData = data;
            
            // If data is an array with path/post structure, extract values
            if (Array.isArray(data) && data.length > 0) {
                if (data[0].path !== undefined && data[0].post !== undefined) {
                    // IS-07 state/event format
                    extractedData = data.map(item => ({
                        path: item.path,
                        value: item.post,
                        pre_value: item.pre
                    }));
                    
                    // If single item, extract just the value
                    if (extractedData.length === 1) {
                        extractedData = extractedData[0].value;
                    }
                }
            }

            return {
                topic,
                data: extractedData,
                source_id: grain.source_id,
                flow_id: grain.flow_id,
                origin_timestamp: grain.origin_timestamp,
                event_type: eventType,
                full_grain: grain
            };
        };

        /**
         * Format output message based on configured output format
         */
        const formatOutputMessage = (parsedGrain) => {
            if (!parsedGrain) return null;

            const baseMsg = {
                topic: parsedGrain.topic,
                source_id: parsedGrain.source_id,
                sender_id: connectionState.active.sender_id,
                event_type: parsedGrain.event_type
            };

            if (node.outputFormat === 'data_only') {
                return {
                    ...baseMsg,
                    payload: parsedGrain.data
                };
            } else if (node.outputFormat === 'full_grain') {
                return {
                    ...baseMsg,
                    payload: parsedGrain.full_grain
                };
            } else { // both
                return {
                    ...baseMsg,
                    payload: parsedGrain.data,
                    grain: parsedGrain.full_grain
                };
            }
        };

        /**
         * Handle received event from any transport
         */
        const handleReceivedEvent = (data, transport) => {
            try {
                let grain;
                if (typeof data === 'string') {
                    grain = JSON.parse(data);
                } else {
                    grain = data;
                }

                const parsed = parseGrain(grain);
                if (!parsed) return;

                const outputMsg = formatOutputMessage(parsed);
                if (outputMsg) {
                    // Update status to show active receiving
                    node.status({ fill: 'blue', shape: 'dot', text: 'receiving' });
                    setTimeout(() => updateStatus(), 2000);
                    
                    node.send(outputMsg);
                }
            } catch (e) {
                node.warn(`Failed to parse grain: ${e.message}`);
            }
        };

        // ============================================================================
        // MQTT Transport
        // ============================================================================

        function setupMQTTClient() {
            if (node.transportType !== 'mqtt' && node.transportType !== 'both') {
                return;
            }

            const subscribeTopic = node.subscriptionFilter;

            node.log(`Connecting MQTT: ${node.mqttBroker}`);
            node.log(`Subscribe pattern: ${subscribeTopic}`);

            mqttClient = mqtt.connect(node.mqttBroker, {
                clientId: `nmos-is07-receiver-${node.receiverId}`,
                clean: true,
                reconnectPeriod: 5000
            });

            mqttClient.on('connect', () => {
                node.log('✓ MQTT connected');
                updateStatus();

                mqttClient.subscribe(subscribeTopic, { qos: node.mqttQos }, (err) => {
                    if (err) {
                        node.error(`Subscribe error: ${err.message}`);
                    } else {
                        node.log(`✓ Subscribed: ${subscribeTopic}`);
                    }
                });
            });

            mqttClient.on('message', (topic, payloadBuffer) => {
                handleReceivedEvent(payloadBuffer.toString(), 'mqtt');
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

        // ============================================================================
        // WebSocket Transport
        // ============================================================================

        function setupWebSocketClient(connectionUri) {
            if (node.transportType !== 'websocket' && node.transportType !== 'both') {
                return;
            }

            node.log(`Connecting WebSocket: ${connectionUri}`);

            const ws = new WebSocket(connectionUri);
            const wsKey = connectionUri;

            ws.on('open', () => {
                node.log(`✓ WebSocket connected: ${connectionUri}`);
                wsClients.set(wsKey, ws);
                updateStatus();
            });

            ws.on('message', (data) => {
                handleReceivedEvent(data.toString(), 'websocket');
            });

            ws.on('error', (err) => {
                node.error(`WebSocket error: ${err.message}`);
                updateStatus();
            });

            ws.on('close', () => {
                node.log(`WebSocket closed: ${connectionUri}`);
                wsClients.delete(wsKey);
                updateStatus();
                
                // Auto-reconnect if still active
                if (connectionState.active.master_enable) {
                    setTimeout(() => {
                        if (connectionState.active.master_enable) {
                            setupWebSocketClient(connectionUri);
                        }
                    }, 5000);
                }
            });
        }

        // ============================================================================
        // IS-05 Connection API
        // ============================================================================

        function setupConnectionAPI() {
            const app = RED.httpNode || RED.httpAdmin;
            
            if (!app) {
                node.warn('HTTP server not available for Connection API');
                return;
            }

            const basePath = '/x-nmos/connection/v1.1';

            // GET /
            const route1 = app.get(`${basePath}/`, (req, res) => {
                res.json(['single/']);
            });
            connectionApiRoutes.push({ method: 'get', path: `${basePath}/` });

            // GET /single/
            const route2 = app.get(`${basePath}/single/`, (req, res) => {
                res.json(['receivers/']);
            });
            connectionApiRoutes.push({ method: 'get', path: `${basePath}/single/` });

            // GET /single/receivers/
            const route3 = app.get(`${basePath}/single/receivers/`, (req, res) => {
                res.json([`${node.receiverId}/`]);
            });
            connectionApiRoutes.push({ method: 'get', path: `${basePath}/single/receivers/` });

            // GET /single/receivers/{receiverId}/
            const route4 = app.get(`${basePath}/single/receivers/${node.receiverId}/`, (req, res) => {
                res.json(['constraints/', 'staged/', 'active/', 'transporttype/']);
            });
            connectionApiRoutes.push({ method: 'get', path: `${basePath}/single/receivers/${node.receiverId}/` });

            // GET /single/receivers/{receiverId}/constraints
            const route5 = app.get(`${basePath}/single/receivers/${node.receiverId}/constraints/`, (req, res) => {
                res.json([]);
            });
            connectionApiRoutes.push({ method: 'get', path: `${basePath}/single/receivers/${node.receiverId}/constraints/` });

            // GET /single/receivers/{receiverId}/staged
            const route6 = app.get(`${basePath}/single/receivers/${node.receiverId}/staged/`, (req, res) => {
                res.json(connectionState.staged);
            });
            connectionApiRoutes.push({ method: 'get', path: `${basePath}/single/receivers/${node.receiverId}/staged/` });

            // PATCH /single/receivers/{receiverId}/staged
            const route7 = app.patch(`${basePath}/single/receivers/${node.receiverId}/staged/`, (req, res) => {
                try {
                    const patch = req.body;
                    
                    // Merge patch into staged
                    if (patch.sender_id !== undefined) {
                        connectionState.staged.sender_id = patch.sender_id;
                    }
                    if (patch.master_enable !== undefined) {
                        connectionState.staged.master_enable = patch.master_enable;
                    }
                    if (patch.activation) {
                        connectionState.staged.activation = {
                            ...connectionState.staged.activation,
                            ...patch.activation
                        };
                    }
                    if (patch.transport_params) {
                        connectionState.staged.transport_params = patch.transport_params;
                    }

                    // Handle activation
                    const activationMode = connectionState.staged.activation.mode;
                    
                    if (activationMode === 'activate_immediate') {
                        applyStaged();
                        connectionState.staged.activation.activation_time = getTAITimestamp();
                    } else if (activationMode === 'activate_scheduled_absolute' || 
                               activationMode === 'activate_scheduled_relative') {
                        // For scheduled, would need to implement timer
                        // For now, treat as immediate
                        applyStaged();
                        connectionState.staged.activation.activation_time = getTAITimestamp();
                    }

                    res.status(200).json(connectionState.staged);
                } catch (err) {
                    node.error(`PATCH staged error: ${err.message}`);
                    res.status(400).json({ error: err.message });
                }
            });
            connectionApiRoutes.push({ method: 'patch', path: `${basePath}/single/receivers/${node.receiverId}/staged/` });

            // GET /single/receivers/{receiverId}/active
            const route8 = app.get(`${basePath}/single/receivers/${node.receiverId}/active/`, (req, res) => {
                res.json(connectionState.active);
            });
            connectionApiRoutes.push({ method: 'get', path: `${basePath}/single/receivers/${node.receiverId}/active/` });

            // GET /single/receivers/{receiverId}/transporttype
            const route9 = app.get(`${basePath}/single/receivers/${node.receiverId}/transporttype/`, (req, res) => {
                res.json(getTransportUrn());
            });
            connectionApiRoutes.push({ method: 'get', path: `${basePath}/single/receivers/${node.receiverId}/transporttype/` });

            node.log('✓ IS-05 Connection API endpoints registered');
        }

        /**
         * Apply staged configuration to active and subscribe
         */
        function applyStaged() {
            // Copy staged to active
            connectionState.active = JSON.parse(JSON.stringify(connectionState.staged));
            
            // Unsubscribe from previous connections
            unsubscribeFromSource();
            
            // Subscribe to new source if enabled
            if (connectionState.active.master_enable && connectionState.active.sender_id) {
                subscribeToSource(connectionState.active);
            }
            
            // Update receiver resource in registry
            if (registrationComplete) {
                registerResource('receiver', buildReceiverResource());
            }
            
            updateStatus();
        }

        /**
         * Subscribe to source based on connection parameters
         */
        function subscribeToSource(connectionParams) {
            const transportParams = connectionParams.transport_params || [];
            
            for (const tp of transportParams) {
                const connUri = tp.connection_uri;
                
                if (!connUri) continue;
                
                if (connUri.startsWith('mqtt://') || connUri.startsWith('mqtts://')) {
                    // MQTT subscription
                    const brokerTopic = tp.broker_topic || node.subscriptionFilter;
                    
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.subscribe(brokerTopic, { qos: node.mqttQos }, (err) => {
                            if (err) {
                                node.error(`Subscribe error: ${err.message}`);
                            } else {
                                node.log(`✓ Subscribed to: ${brokerTopic}`);
                            }
                        });
                    }
                } else if (connUri.startsWith('ws://') || connUri.startsWith('wss://')) {
                    // WebSocket connection
                    setupWebSocketClient(connUri);
                }
            }
        }

        /**
         * Unsubscribe from all sources
         */
        function unsubscribeFromSource() {
            // Close all WebSocket connections
            for (const [uri, ws] of wsClients.entries()) {
                ws.close();
            }
            wsClients.clear();
            
            // For MQTT, we keep the wildcard subscription
            // Individual topic management could be added here if needed
        }

        // ============================================================================
        // Status Management
        // ============================================================================

        function updateStatus() {
            const mqttOk = (node.transportType === 'mqtt' || node.transportType === 'both') ? 
                (mqttClient && mqttClient.connected) : true;
            const wsOk = (node.transportType === 'websocket' || node.transportType === 'both') ? 
                (wsClients.size > 0) : true;
            
            if (!registrationComplete) {
                node.status({ fill: 'yellow', shape: 'dot', text: 'not registered' });
            } else if (!mqttOk && !wsOk) {
                node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
            } else if (mqttOk && wsOk) {
                if (connectionState.active.sender_id) {
                    node.status({ fill: 'green', shape: 'dot', text: 'subscribed' });
                } else {
                    node.status({ fill: 'green', shape: 'dot', text: 'ready' });
                }
            } else {
                node.status({ fill: 'yellow', shape: 'dot', text: 'partial' });
            }
        }

        // ============================================================================
        // Node Input Handler
        // ============================================================================

        node.on('input', async (msg) => {
            try {
                const action = (msg.payload && msg.payload.action) || msg.action;

                if (!action) {
                    node.warn('No action specified');
                    return;
                }

                switch (action) {
                    case 'subscribe':
                        // Subscribe to specific sender
                        const senderId = msg.payload.sender_id;
                        const connectionUri = msg.payload.connection_uri;
                        
                        if (!senderId || !connectionUri) {
                            throw new Error('subscribe requires sender_id and connection_uri');
                        }
                        
                        connectionState.staged.sender_id = senderId;
                        connectionState.staged.master_enable = true;
                        connectionState.staged.activation.mode = 'activate_immediate';
                        connectionState.staged.transport_params = [{
                            connection_uri: connectionUri,
                            connection_authorization: false
                        }];
                        
                        if (connectionUri.startsWith('mqtt://')) {
                            connectionState.staged.transport_params[0].broker_topic = 
                                msg.payload.broker_topic || node.subscriptionFilter;
                        }
                        
                        applyStaged();
                        
                        msg.payload = { 
                            success: true, 
                            action: 'subscribe',
                            sender_id: senderId 
                        };
                        node.send(msg);
                        break;

                    case 'unsubscribe':
                        connectionState.staged.sender_id = null;
                        connectionState.staged.master_enable = false;
                        applyStaged();
                        
                        msg.payload = { success: true, action: 'unsubscribe' };
                        node.send(msg);
                        break;

                    case 'get_state':
                        msg.payload = {
                            nodeId: node.nodeId,
                            deviceId: node.deviceId,
                            receiverId: node.receiverId,
                            registered: registrationComplete,
                            transportType: node.transportType,
                            mqttConnected: mqttClient ? mqttClient.connected : false,
                            wsConnections: wsClients.size,
                            connectionState: connectionState,
                            registrationUrl: getRegistrationApiUrl()
                        };
                        node.send(msg);
                        break;

                    case 're-register':
                        node.log('Manual re-registration requested');
                        await registerAll();
                        break;

                    case 'get_subscriptions':
                        msg.payload = {
                            active: connectionState.active,
                            staged: connectionState.staged,
                            sender_id: connectionState.active.sender_id,
                            master_enable: connectionState.active.master_enable
                        };
                        node.send(msg);
                        break;

                    default:
                        node.warn(`Unknown action: ${action}`);
                }
            } catch (err) {
                node.error(`Input error: ${err.message}`);
                msg.payload = { error: err.message };
                node.send(msg);
            }
        });

        // ============================================================================
        // Lifecycle
        // ============================================================================

        // Setup Connection API first
        setupConnectionAPI();

        // Setup transports
        if (node.transportType === 'mqtt' || node.transportType === 'both') {
            setupMQTTClient();
        }

        // Register with IS-04
        registerAll().then(ok => {
            if (ok) {
                heartbeatInterval = setInterval(sendHeartbeat, 5000);
                setTimeout(sendHeartbeat, 1000);
            } else {
                node.warn('Initial registration failed, will retry in 10s');
                setTimeout(registerAll, 10000);
            }
        });

        node.on('close', (done) => {
            node.log('Shutting down IS-07 Receiver...');
            
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            
            // Unsubscribe
            unsubscribeFromSource();
            
            if (mqttClient) {
                mqttClient.end(true);
            }
            
            // Note: HTTP routes are managed by Node-RED, cleanup handled automatically
            
            node.log('✓ Shutdown complete');
            done();
        });
    }

    RED.nodes.registerType("nmos-is07-receiver", NMOSIS07ReceiverNode);
};
