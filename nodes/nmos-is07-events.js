/**
 * nodes/nmos-is07-events.js
 * NMOS IS-07 Events & Tally - Fixed Registration
 */

const mqtt = require('mqtt');
const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

module.exports = function(RED) {
    function NMOSIS07EventsNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.registry = RED.nodes.getNode(config.registry);
        node.mqttBroker = config.mqttBroker || 'mqtt://localhost:1883';
        node.deviceLabel = config.deviceLabel || 'Node-RED IS-07 Events';
        node.deviceDescription = config.deviceDescription || 'IS-07 Events source';
        node.sourceLabel = config.sourceLabel || 'Event Source';
        node.flowLabel = config.flowLabel || 'Event Flow';
        node.senderLabel = config.senderLabel || 'Event Sender';
        node.eventType = config.eventType || 'boolean';
        node.mqttQos = parseInt(config.mqttQos) || 0;
        node.mqttCleanSession = config.mqttCleanSession !== false;
        
        // Resource IDs
        node.nodeId = config.nodeId || uuidv4();
        node.deviceId = config.deviceId || uuidv4();
        node.sourceId = config.sourceId || uuidv4();
        node.flowId = config.flowId || uuidv4();
        node.senderId = config.senderId || uuidv4();

        let mqttClient = null;
        let registrationComplete = false;
        let heartbeatInterval = null;

        // State management
        const propertyState = new Map();

        // IS-05 Connection API state for sender
        const senderConnectionState = {
            staged: {
                receiver_id: null,
                master_enable: true,
                activation: {
                    mode: null,
                    requested_time: null,
                    activation_time: null
                },
                transport_params: []
            },
            active: {
                receiver_id: null,
                master_enable: true,
                activation: {
                    mode: null,
                    requested_time: null,
                    activation_time: null
                },
                transport_params: []
            },
            constraints: [],
            transporttype: 'urn:x-nmos:transport:mqtt'
        };

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

        const getSubscribePattern = () => {
            return 'x-nmos/events/1.0/+/+';
        };

        // ============================================================================
        // IS-04 Resource Builders (FIXED)
        // ============================================================================

        const buildNodeResource = () => {
            const resource = {
                id: node.nodeId,
                version: getTAITimestamp(),
                label: `${node.deviceLabel} Node`,
                description: node.deviceDescription,
                href: `http://${localIP}:${node.registry.httpPort || 1880}/`,
                hostname: os.hostname(),
                caps: {},
                tags: {},
                api: {
                    versions: [node.registry.queryApiVersion],
                    endpoints: [{
                        host: localIP,
                        port: node.registry.httpPort || 1880,
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

            // Add services array for v1.1+
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
                tags: {
                    'urn:x-nmos:tag:is07/role': ['sender']
                }
            };

            // Add controls array for v1.1+
            if (node.registry.queryApiVersion >= 'v1.1') {
                const httpPort = node.registry.httpPort || 1880;
                const connectionAPIBase = `http://${localIP}:${httpPort}/x-nmos/connection/${node.registry.connectionApiVersion}`;
                resource.controls = [{
                    type: `urn:x-nmos:control:sr-ctrl/${node.registry.connectionApiVersion}`,
                    href: connectionAPIBase + '/'
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

            // Add event_type to tags
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

            // Add grain_rate for v1.1+
            if (node.registry.queryApiVersion >= 'v1.1') {
                resource.grain_rate = {
                    numerator: 0,
                    denominator: 1
                };
            }

            // Add media_type for data format
            resource.media_type = 'application/json';

            // Add event_type to tags
            resource.tags['urn:x-nmos:tag:is07/event_type'] = [node.eventType];

            return resource;
        };

        const buildSenderResource = () => {
            const httpPort = node.registry.httpPort || 1880;
            const manifestUrl = `http://${localIP}:${httpPort}/x-nmos/events/manifest/${node.senderId}`;
            
            const resource = {
                id: node.senderId,
                version: getTAITimestamp(),
                label: node.senderLabel,
                description: `IS-07 Event Sender (${node.eventType})`,
                format: 'urn:x-nmos:format:data',
                caps: {
                    media_types: ['application/json']
                },
                tags: {
                    'urn:x-nmos:tag:is07/event_type': [node.eventType],
                    'urn:x-nmos:tag:is07/transport': ['mqtt']
                },
                flow_id: node.flowId,
                device_id: node.deviceId,
                transport: 'urn:x-nmos:transport:mqtt',
                interface_bindings: [ifaceName],
                manifest_href: manifestUrl,
                subscription: {
                    receiver_id: senderConnectionState.active.receiver_id,
                    active: senderConnectionState.active.master_enable
                }
            };

            return resource;
        };

        // ============================================================================
        // IS-04 Registration (IMPROVED ERROR HANDLING)
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
                node.log(`URL: ${registrationApiUrl}/resource`);
                node.log(`Payload: ${JSON.stringify(payload, null, 2)}`);

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
                node.log('Starting IS-07 Registration');
                node.log(`Registry: ${getRegistrationApiUrl()}`);
                node.log(`API Version: ${node.registry.queryApiVersion}`);
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
                node.status({ fill: 'green', shape: 'dot', text: 'registered' });
                node.log('═══════════════════════════════════════');
                node.log('✓ ALL IS-07 RESOURCES REGISTERED');
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
        // IS-07 Grain Message Builders
        // ============================================================================

        const buildGrainMessage = (topic, data, isState = false) => {
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
                    topic: topic,
                    data: data.map(item => ({
                        path: item.path,
                        pre: isState ? null : item.pre,
                        post: item.post
                    }))
                }
            };
        };

        const buildStateMessage = () => {
            const data = [];
            propertyState.forEach((value, path) => {
                data.push({ path, pre: null, post: value });
            });

            if (data.length === 0) {
                data.push({ path: 'state', pre: null, post: 'initialized' });
            }

            return buildGrainMessage('state', data, true);
        };

        const buildEventMessage = (path, preValue, postValue) => {
            return buildGrainMessage('event', [{ path, pre: preValue, post: postValue }], false);
        };

        // ============================================================================
        // MQTT Functions
        // ============================================================================

        function setupMQTTClient() {
            const publishTopic = getPublishTopic();
            const subscribePattern = getSubscribePattern();

            node.log(`Connecting MQTT: ${node.mqttBroker}`);
            node.log(`Publish topic: ${publishTopic}`);

            mqttClient = mqtt.connect(node.mqttBroker, {
                clientId: `nmos-is07-${node.sourceId}`,
                clean: node.mqttCleanSession,
                reconnectPeriod: 5000
            });

            mqttClient.on('connect', () => {
                node.log('✓ MQTT connected');
                const statusColor = registrationComplete ? 'green' : 'yellow';
                node.status({ fill: statusColor, shape: 'dot', text: 'mqtt connected' });

                mqttClient.subscribe(subscribePattern, { qos: node.mqttQos }, (err) => {
                    if (err) {
                        node.error(`Subscribe error: ${err.message}`);
                    } else {
                        node.log(`✓ Subscribed: ${subscribePattern}`);
                        setTimeout(() => publishState(), 1000);
                    }
                });
            });

            mqttClient.on('message', (topic, payloadBuffer) => {
                try {
                    const grain = JSON.parse(payloadBuffer.toString());
                    
                    // Don't echo our own messages
                    if (grain.source_id === node.sourceId) return;

                    node.log(`◄ Event from ${grain.source_id}`);

                    node.send({
                        topic: topic,
                        payload: grain,
                        source_id: grain.source_id,
                        flow_id: grain.flow_id
                    });
                } catch (e) {
                    node.warn('Invalid grain message received');
                }
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

        function publishState() {
            if (!mqttClient || !mqttClient.connected) {
                node.warn('Cannot publish state: MQTT not connected');
                return false;
            }

            const grain = buildStateMessage();
            const topic = getPublishTopic();

            mqttClient.publish(topic, JSON.stringify(grain), {
                qos: node.mqttQos,
                retain: true
            }, (err) => {
                if (err) {
                    node.error(`Publish state error: ${err.message}`);
                } else {
                    node.log(`► Published state (${propertyState.size} properties)`);
                }
            });

            return true;
        }

        function publishEvent(path, preValue, postValue) {
            if (!mqttClient || !mqttClient.connected) {
                node.warn('Cannot publish event: MQTT not connected');
                return false;
            }

            const grain = buildEventMessage(path, preValue, postValue);
            const topic = getPublishTopic();

            mqttClient.publish(topic, JSON.stringify(grain), {
                qos: node.mqttQos,
                retain: false
            }, (err) => {
                if (err) {
                    node.error(`Publish event error: ${err.message}`);
                } else {
                    node.log(`► Event: ${path} ${preValue} → ${postValue}`);
                }
            });

            return true;
        }

        function setProperty(path, value) {
            const preValue = propertyState.get(path) || null;
            propertyState.set(path, value);
            return publishEvent(path, preValue, value);
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
                    case 'get_state':
                        msg.payload = {
                            nodeId: node.nodeId,
                            deviceId: node.deviceId,
                            sourceId: node.sourceId,
                            flowId: node.flowId,
                            registered: registrationComplete,
                            mqttConnected: mqttClient && mqttClient.connected,
                            mqttBroker: node.mqttBroker,
                            publishTopic: getPublishTopic(),
                            subscribeTopic: getSubscribePattern(),
                            eventType: node.eventType,
                            properties: Object.fromEntries(propertyState),
                            registrationUrl: getRegistrationApiUrl()
                        };
                        node.send(msg);
                        break;

                    case 'send_state':
                        const stateOk = publishState();
                        msg.payload = { success: stateOk, action: 'send_state' };
                        node.send(msg);
                        break;

                    case 'send_event':
                        const { path, pre, post } = msg.payload;
                        if (!path || post === undefined) {
                            throw new Error('send_event requires path and post value');
                        }
                        const eventOk = publishEvent(path, pre || null, post);
                        msg.payload = { success: eventOk, action: 'send_event', path, pre, post };
                        node.send(msg);
                        break;

                    case 'set_property':
                        const propPath = msg.payload.path || msg.path;
                        const propValue = msg.payload.value !== undefined ? msg.payload.value : msg.value;
                        if (!propPath || propValue === undefined) {
                            throw new Error('set_property requires path and value');
                        }
                        const propOk = setProperty(propPath, propValue);
                        msg.payload = { success: propOk, action: 'set_property', path: propPath, value: propValue };
                        node.send(msg);
                        break;

                    case 're-register':
                        node.log('Manual re-registration requested');
                        await registerAll();
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
        // ============================================================================
        // HTTP Manifest Endpoint
        // ============================================================================

        const manifestPath = `/x-nmos/events/manifest/${node.senderId}`;
        
        RED.httpNode.get(manifestPath, (req, res) => {
            const manifest = {
                id: node.senderId,
                version: getTAITimestamp(),
                label: node.senderLabel,
                description: `IS-07 Event Sender Manifest (${node.eventType})`,
                format: 'urn:x-nmos:format:data',
                event_types: [
                    {
                        name: node.eventType,
                        description: `${node.eventType.charAt(0).toUpperCase() + node.eventType.slice(1)} event type`,
                        type: node.eventType
                    }
                ],
                source_id: node.sourceId,
                flow_id: node.flowId,
                device_id: node.deviceId
            };

            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(manifest);
            node.log(`◄ Manifest requested: ${manifestPath}`);
        });

        node.log(`✓ Manifest endpoint: http://${localIP}:${node.registry.httpPort || 1880}${manifestPath}`);

        // ============================================================================
        // IS-05 Connection API Endpoints
        // ============================================================================

        const updateSenderInRegistry = async () => {
            if (!registrationComplete) return;
            try {
                await registerResource('sender', buildSenderResource());
                node.log('✓ Sender updated in registry');
            } catch (err) {
                node.warn(`Failed to update sender: ${err.message}`);
            }
        };

        const setupConnectionAPI = () => {
            const connectionApiVersion = node.registry.connectionApiVersion || 'v1.0';
            const senderBasePath = `/x-nmos/connection/${connectionApiVersion}/single/senders/${node.senderId}`;
            
            const middleware = (req, res, next) => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                
                if (req.method === 'OPTIONS') {
                    res.sendStatus(200);
                    return;
                }
                next();
            };
            
            // Sender endpoints
            RED.httpNode.get(`${senderBasePath}/staged`, middleware, (req, res) => {
                res.json(senderConnectionState.staged);
            });
            
            RED.httpNode.patch(`${senderBasePath}/staged`, middleware, (req, res) => {
                try {
                    const patch = req.body;
                    
                    if (patch.receiver_id !== undefined) {
                        senderConnectionState.staged.receiver_id = patch.receiver_id;
                    }
                    if (patch.master_enable !== undefined) {
                        senderConnectionState.staged.master_enable = patch.master_enable;
                    }
                    if (patch.activation !== undefined) {
                        senderConnectionState.staged.activation = {
                            ...senderConnectionState.staged.activation,
                            ...patch.activation
                        };
                    }
                    if (patch.transport_params !== undefined) {
                        senderConnectionState.staged.transport_params = patch.transport_params;
                    }
                    
                    if (patch.activation && patch.activation.mode === 'activate_immediate') {
                        senderConnectionState.active = JSON.parse(JSON.stringify(senderConnectionState.staged));
                        senderConnectionState.active.activation.activation_time = getTAITimestamp();
                        
                        node.log(`✓ Sender connection activated: ${senderConnectionState.active.receiver_id}`);
                        updateSenderInRegistry();
                        
                        const msg = {
                            payload: {
                                event: 'sender_connection_activated',
                                receiver_id: senderConnectionState.active.receiver_id,
                                master_enable: senderConnectionState.active.master_enable,
                                activation_time: senderConnectionState.active.activation.activation_time
                            },
                            senderId: node.senderId,
                            topic: 'connection'
                        };
                        node.send(msg);
                    }
                    
                    res.json(senderConnectionState.staged);
                } catch (error) {
                    res.status(400).json({
                        code: 400,
                        error: error.message,
                        debug: error.stack
                    });
                }
            });
            
            RED.httpNode.get(`${senderBasePath}/active`, middleware, (req, res) => {
                res.json(senderConnectionState.active);
            });
            
            RED.httpNode.get(`${senderBasePath}/constraints`, middleware, (req, res) => {
                res.json(senderConnectionState.constraints);
            });
            
            RED.httpNode.get(`${senderBasePath}/transporttype`, middleware, (req, res) => {
                res.json(senderConnectionState.transporttype);
            });
            
            node.log(`✓ IS-05 Sender API: http://${localIP}:${node.registry.httpPort || 1880}${senderBasePath}`);
        };

        setupConnectionAPI();

        // ============================================================================
        // Lifecycle
        // ============================================================================

        // Start MQTT first
        setupMQTTClient();

        // Then register with IS-04
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
            node.log('Shutting down IS-07 node...');
            
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            
            if (mqttClient) {
                mqttClient.end(true);
            }

            (async () => {
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = node.registry.getAuthHeaders();
                try {
                    // Delete in reverse order: Sender → Flow → Source → Device → Node
                    await axios.delete(`${registrationApiUrl}/resource/senders/${node.senderId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/flows/${node.flowId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/sources/${node.sourceId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/devices/${node.deviceId}`, { headers }).catch(() => {});
                    await axios.delete(`${registrationApiUrl}/resource/nodes/${node.nodeId}`, { headers }).catch(() => {});
                    node.log('✓ Unregistered from IS-04');
                } catch (e) {
                    node.warn('Unregister error (this is normal on shutdown)');
                }
            })().finally(() => {
                done();
            });
        });
    }

    RED.nodes.registerType('nmos-is07-events', NMOSIS07EventsNode);
};