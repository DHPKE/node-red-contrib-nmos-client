/**
 * nodes/nmos-is07-sender.js
 * NMOS IS-07 Sender - Publish events with manifest endpoint support
 */

const mqtt = require('mqtt');
const axios = require('axios');
const os = require('os');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

module.exports = function(RED) {
    function NMOSIS07SenderNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.registry = RED.nodes.getNode(config.registry);
        node.mqttBroker = config.mqttBroker || 'mqtt://localhost:1883';
        node.deviceLabel = config.deviceLabel || 'Node-RED IS-07 Sender';
        node.deviceDescription = config.deviceDescription || 'IS-07 Event Sender';
        node.senderLabel = config.senderLabel || 'Event Sender';
        node.sourceLabel = config.sourceLabel || 'Event Source';
        node.flowLabel = config.flowLabel || 'Event Flow';
        node.eventType = config.eventType || 'boolean';
        node.transportType = config.transportType || 'mqtt';
        node.wsPort = parseInt(config.wsPort) || 3002;
        node.mqttQos = parseInt(config.mqttQos) || 0;
        node.httpPort = parseInt(config.httpPort) || 1880;
        node.targetReceiverId = config.targetReceiverId || null;
        
        // Resource IDs
        node.nodeId = config.nodeId || uuidv4();
        node.deviceId = config.deviceId || uuidv4();
        node.sourceId = config.sourceId || uuidv4();
        node.flowId = config.flowId || uuidv4();
        node.senderId = config.senderId || uuidv4();

        let mqttClient = null;
        let registrationComplete = false;
        let heartbeatInterval = null;
        let httpServer = null;
        let wss = null;
        let wsConnections = new Set();

        if (!node.registry) {
            node.error('No NMOS registry configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            return;
        }

        if (!node.mqttBroker) {
            node.error('No MQTT broker configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no mqtt' });
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
         * Get MQTT topic for this source
         * IS-07 spec: x-nmos/events/1.0/{source_id}/{event_type}
         */
        const getPublishTopic = () => {
            return `x-nmos/events/1.0/${node.sourceId}/${node.eventType}`;
        };

        /**
         * Get event type URN for NMOS specification
         */
        const getEventTypeUrn = () => {
            return `urn:x-nmos:event_type:${node.eventType}/v1.0`;
        };

        /**
         * Get manifest URL
         */
        const getManifestUrl = () => {
            return `http://${localIP}:${node.httpPort}/x-nmos/events/sources/${node.sourceId}/manifest`;
        };

        // ============================================================================
        // HTTP Manifest Endpoint
        // ============================================================================

        /**
         * Build manifest JSON according to IS-07 spec
         */
        const buildManifest = () => {
            return {
                id: node.sourceId,
                label: node.sourceLabel,
                description: `IS-07 Event Source (${node.eventType})`,
                tags: {},
                state: {
                    event_type: getEventTypeUrn(),
                    description: `Current ${node.eventType} state`
                },
                events: [{
                    event_type: getEventTypeUrn(),
                    description: `${node.eventType} event updates`
                }]
            };
        };

        /**
         * Setup HTTP server for manifest endpoint
         */
        function setupManifestEndpoint() {
            const manifestPath = `/x-nmos/events/sources/${node.sourceId}/manifest`;
            
            httpServer = http.createServer((req, res) => {
                if (req.url === manifestPath && req.method === 'GET') {
                    const manifest = buildManifest();
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify(manifest, null, 2));
                    node.log(`Served manifest to ${req.socket.remoteAddress}`);
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not Found');
                }
            });

            httpServer.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    node.warn(`Port ${node.httpPort} already in use, manifest endpoint may conflict`);
                } else {
                    node.error(`HTTP server error: ${err.message}`);
                }
            });

            httpServer.listen(node.httpPort, () => {
                node.log(`Manifest endpoint listening on port ${node.httpPort}`);
                node.log(`Manifest URL: ${getManifestUrl()}`);
            });
        }

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
                senders: [node.senderId],
                receivers: [],
                tags: {}
            };

            if (node.registry.queryApiVersion >= 'v1.1') {
                resource.controls = [];
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
            // Determine transport URN based on configuration
            let transport;
            let transportTags = [];
            
            if (node.transportType === 'mqtt') {
                transport = 'urn:x-nmos:transport:mqtt';
                transportTags = ['mqtt'];
            } else if (node.transportType === 'websocket') {
                transport = 'urn:x-nmos:transport:websocket';
                transportTags = ['websocket'];
            } else if (node.transportType === 'both') {
                transport = 'urn:x-nmos:transport:mqtt'; // Primary transport
                transportTags = ['mqtt', 'websocket'];
            }
            
            const resource = {
                id: node.senderId,
                version: getTAITimestamp(),
                label: node.senderLabel,
                description: `IS-07 Event Sender - ${node.senderLabel}`,
                flow_id: node.flowId,
                transport: transport,
                tags: {
                    'urn:x-nmos:tag:is07/event_type': [node.eventType],
                    'urn:x-nmos:tag:is07/transport': transportTags
                },
                device_id: node.deviceId,
                manifest_href: getManifestUrl(),
                interface_bindings: [ifaceName],
                subscription: {
                    receiver_id: node.targetReceiverId,
                    active: true
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
                node.log(`API Version: ${node.registry.queryApiVersion}`);
                node.log(`Manifest URL: ${getManifestUrl()}`);
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

                // Step 3: Register Source
                const ok3 = await registerResource('source', buildSourceResource());
                if (!ok3) {
                    throw new Error('Source registration failed');
                }
                await new Promise(r => setTimeout(r, 300));

                // Step 4: Register Flow
                const ok4 = await registerResource('flow', buildFlowResource());
                if (!ok4) {
                    throw new Error('Flow registration failed');
                }
                await new Promise(r => setTimeout(r, 300));

                // Step 5: Register Sender
                const ok5 = await registerResource('sender', buildSenderResource());
                if (!ok5) {
                    throw new Error('Sender registration failed');
                }

                registrationComplete = true;
                node.status({ fill: 'green', shape: 'dot', text: 'operational' });
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
        // IS-07 Grain Message Builder
        // ============================================================================

        const buildGrainMessage = (payload) => {
            const timestamp = getTAITimestamp();
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
                    topic: 'event',
                    data: [{
                        path: 'event',
                        pre: null,
                        post: payload
                    }]
                }
            };
        };

        // ============================================================================
        // MQTT Functions
        // ============================================================================

        function setupMQTTClient() {
            const publishTopic = getPublishTopic();

            node.log(`Connecting MQTT: ${node.mqttBroker}`);
            node.log(`Publish topic: ${publishTopic}`);

            mqttClient = mqtt.connect(node.mqttBroker, {
                clientId: `nmos-is07-sender-${node.senderId}`,
                clean: true,
                reconnectPeriod: 5000
            });

            mqttClient.on('connect', () => {
                const statusText = node.transportType === 'both' ? 'mqtt ready' : 'connected';
                node.log('✓ MQTT connected');
                const statusColor = registrationComplete ? 'green' : 'yellow';
                node.status({ fill: statusColor, shape: 'dot', text: statusText });
            });

            mqttClient.on('error', (err) => {
                node.error(`MQTT error: ${err.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'mqtt error' });
            });

            mqttClient.on('offline', () => {
                node.warn('MQTT offline');
                node.status({ fill: 'yellow', shape: 'ring', text: 'offline' });
            });

            mqttClient.on('reconnect', () => {
                node.log('MQTT reconnecting...');
            });
        }

        function setupWebSocketServer() {
            if (node.transportType === 'websocket' || node.transportType === 'both') {
                try {
                    wss = new WebSocket.Server({
                        port: node.wsPort,
                        path: `/x-nmos/events/1.0/${node.sourceId}`
                    });

                    wss.on('connection', (ws) => {
                        wsConnections.add(ws);
                        node.log(`✓ WebSocket client connected (${wsConnections.size} total)`);

                        ws.on('close', () => {
                            wsConnections.delete(ws);
                            node.log(`WebSocket client disconnected (${wsConnections.size} remaining)`);
                        });

                        ws.on('error', (err) => {
                            node.error(`WebSocket client error: ${err.message}`);
                        });
                    });

                    wss.on('error', (err) => {
                        node.error(`WebSocket server error: ${err.message}`);
                    });

                    node.log(`✓ WebSocket server listening on port ${node.wsPort}`);
                } catch (err) {
                    node.error(`Failed to start WebSocket server: ${err.message}`);
                }
            }
        }

        function publishEvent(payload) {
            let mqttSuccess = false;
            let wsSuccess = false;

            const grain = buildGrainMessage(payload);
            const message = JSON.stringify(grain);

            // Publish via MQTT if enabled
            if ((node.transportType === 'mqtt' || node.transportType === 'both') && mqttClient && mqttClient.connected) {
                const topic = getPublishTopic();
                mqttClient.publish(topic, message, { qos: node.mqttQos }, (err) => {
                    if (err) {
                        node.error(`MQTT publish failed: ${err.message}`);
                    } else {
                        node.log(`► MQTT: Published to ${topic}`);
                        mqttSuccess = true;
                    }
                });
            }

            // Publish via WebSocket if enabled
            if ((node.transportType === 'websocket' || node.transportType === 'both') && wsConnections.size > 0) {
                wsConnections.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(message);
                            wsSuccess = true;
                        } catch (err) {
                            node.error(`WebSocket send failed: ${err.message}`);
                        }
                    }
                });
                if (wsSuccess) {
                    node.log(`► WebSocket: Published to ${wsConnections.size} client(s)`);
                }
            }

            return mqttSuccess || wsSuccess;
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
                        mqttConnected: mqttClient && mqttClient.connected,
                        mqttBroker: node.mqttBroker,
                        publishTopic: getPublishTopic(),
                        eventType: node.eventType,
                        manifestUrl: getManifestUrl(),
                        registrationUrl: getRegistrationApiUrl()
                    };
                    node.send(msg);
                } else if (action === 're-register') {
                    node.log('Manual re-registration requested');
                    await registerAll();
                } else {
                    // Default: publish payload as event
                    const payload = msg.payload;
                    const success = publishEvent(payload);
                    if (success) {
                        msg.payload = { success: true, published: payload };
                        node.send(msg);
                    }
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

        // Start HTTP manifest endpoint
        setupManifestEndpoint();

        // Start transports based on configuration
        if (node.transportType === 'mqtt' || node.transportType === 'both') {
            setupMQTTClient();
        }
        if (node.transportType === 'websocket' || node.transportType === 'both') {
            setupWebSocketServer();
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
            node.log('Shutting down IS-07 sender...');
            
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            
            // Close MQTT
            if (mqttClient) {
                mqttClient.end(true);
            }

            // Close WebSocket
            if (wss) {
                wsConnections.forEach(ws => ws.close());
                wss.close(() => {
                    node.log('✓ WebSocket server closed');
                });
            }

            if (httpServer) {
                httpServer.close();
            }

            (async () => {
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = node.registry.getAuthHeaders();
                try {
                    await axios.delete(`${registrationApiUrl}/resource/senders/${node.senderId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/flows/${node.flowId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/sources/${node.sourceId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/devices/${node.deviceId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/nodes/${node.nodeId}`, { headers }).catch(() => {});
                    node.log('Resources deregistered');
                } catch (err) {
                    node.warn(`Cleanup error: ${err.message}`);
                }
                done();
            })();
        });
    }

    RED.nodes.registerType('nmos-is07-sender', NMOSIS07SenderNode);
};
