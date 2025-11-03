/**
 * nodes/nmos-is07-endpoint.js
 * NMOS IS-07 Endpoint - Receive control commands and tally from IS-07 sources
 * Supports RIEDEL Smartpanel and other broadcast control systems
 */

const mqtt = require('mqtt');
const WebSocket = require('ws');
const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

module.exports = function(RED) {
    function NMOSIS07EndpointNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.registry = RED.nodes.getNode(config.registry);
        node.mqttBroker = config.mqttBroker || 'mqtt://localhost:1883';
        node.deviceLabel = config.deviceLabel || 'Node-RED IS-07 Endpoint';
        node.deviceDescription = config.deviceDescription || 'IS-07 Endpoint receiver';
        node.receiverLabel = config.receiverLabel || 'Endpoint Receiver';
        node.subscriptionFilter = config.subscriptionFilter || 'x-nmos/events/1.0/+/+';
        node.mqttQos = parseInt(config.mqttQos) || 0;
        node.sendStatusUpdates = config.sendStatusUpdates !== false;
        node.statusSourceId = config.statusSourceId || uuidv4();
        node.parseSmartpanel = config.parseSmartpanel !== false;
        
        // Sender configuration
        node.enableSender = config.enableSender !== false;
        node.senderLabel = config.senderLabel || 'Endpoint Sender';
        node.flowLabel = config.flowLabel || 'Endpoint Flow';
        
        // Transport configuration
        node.transportMode = config.transportMode || 'mqtt'; // 'mqtt', 'websocket', or 'both'
        node.wsPort = parseInt(config.wsPort) || (node.registry.httpPort || 1880) + 1;
        
        // Resource IDs
        node.nodeId = config.nodeId || uuidv4();
        node.deviceId = config.deviceId || uuidv4();
        node.receiverId = config.receiverId || uuidv4();
        node.senderId = config.senderId || uuidv4();
        node.flowId = config.flowId || uuidv4();

        let mqttClient = null;
        let wsServer = null;
        let wsClients = new Set();
        let registrationComplete = false;
        let heartbeatInterval = null;

        // State management
        const receivedStates = new Map(); // Track states from various sources
        const localState = new Map(); // Local endpoint state
        const commandHistory = []; // Track command history
        const MAX_HISTORY = 100;

        // IS-05 Connection API state for receiver
        const receiverConnectionState = {
            staged: {
                sender_id: null,
                master_enable: false,
                activation: {
                    mode: null,
                    requested_time: null,
                    activation_time: null
                },
                transport_params: []
            },
            active: {
                sender_id: null,
                master_enable: false,
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

        // IS-05 Connection API state for sender (if enabled)
        const senderConnectionState = node.enableSender ? {
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
        } : null;

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
         * Parse RIEDEL Smartpanel commands from IS-07 events
         * Smartpanel typically sends commands via GPIO/tally paths
         */
        const parseSmartpanelCommand = (grain) => {
            if (!node.parseSmartpanel || !grain.grain || !grain.grain.data) {
                return null;
            }

            const data = grain.grain.data;
            const commands = [];

            for (const item of data) {
                const path = item.path || '';
                const value = item.post;

                // Common Smartpanel patterns
                // GPIO inputs: gpio/input/N or gpi/N
                // Tally outputs: tally/red, tally/green, tally/amber
                // Button presses: button/N or key/N
                // Faders: fader/N or level/N
                
                let command = {
                    raw_path: path,
                    raw_value: value,
                    pre_value: item.pre,
                    timestamp: new Date().toISOString()
                };

                // Parse GPIO/GPI
                if (path.match(/^gpi?o?\/(input|in)\/(\d+)$/i)) {
                    const match = path.match(/(\d+)$/);
                    if (match) {
                        command.type = 'gpio';
                        command.gpio = parseInt(match[1]);
                        command.state = !!value;
                    }
                }
                // Parse button
                else if (path.match(/^(button|key|switch)\/(\d+)$/i)) {
                    const match = path.match(/(\d+)$/);
                    if (match) {
                        command.type = 'button';
                        command.button = parseInt(match[1]);
                        command.pressed = !!value;
                    }
                }
                // Parse tally
                else if (path.match(/^tally\/(red|green|amber|yellow|program|preview)$/i)) {
                    const match = path.match(/\/(red|green|amber|yellow|program|preview)$/i);
                    if (match) {
                        command.type = 'tally';
                        command.color = match[1].toLowerCase();
                        command.state = !!value;
                    }
                }
                // Parse fader/level
                else if (path.match(/^(fader|level|gain)\/(\d+)$/i)) {
                    const match = path.match(/(\d+)$/);
                    if (match) {
                        command.type = 'fader';
                        command.fader = parseInt(match[1]);
                        command.value = parseFloat(value) || 0;
                    }
                }
                // Parse encoder/rotary
                else if (path.match(/^(encoder|rotary)\/(\d+)$/i)) {
                    const match = path.match(/(\d+)$/);
                    if (match) {
                        command.type = 'encoder';
                        command.encoder = parseInt(match[1]);
                        command.value = parseFloat(value) || 0;
                    }
                }
                // Generic property
                else {
                    command.type = 'property';
                    command.path = path;
                    command.value = value;
                }

                commands.push(command);
            }

            return commands;
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
                href: `http://${localIP}:${node.registry.httpPort || 1880}/`,
                hostname: os.hostname(),
                caps: {},
                tags: {
                    'urn:x-nmos:tag:is07/role': ['endpoint']
                },
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
                senders: node.enableSender ? [node.senderId] : [],
                receivers: [node.receiverId],
                tags: {
                    'urn:x-nmos:tag:is07/endpoint': ['true'],
                    'urn:x-nmos:tag:is07/role': node.enableSender ? ['receiver', 'sender'] : ['receiver']
                }
            };

            if (node.registry.queryApiVersion >= 'v1.1') {
                const httpPort = node.registry.httpPort || 1880;
                const connectionApiVersion = node.registry.connectionApiVersion || 'v1.0';
                const connectionAPIBase = `http://${localIP}:${httpPort}/x-nmos/connection/${connectionApiVersion}`;
                resource.controls = [{
                    type: `urn:x-nmos:control:sr-ctrl/${connectionApiVersion}`,
                    href: connectionAPIBase + '/'
                }];
            }

            return resource;
        };

        const buildReceiverResource = () => {
            const resource = {
                id: node.receiverId,
                version: getTAITimestamp(),
                label: node.receiverLabel,
                description: `IS-07 Endpoint Receiver - ${node.receiverLabel}`,
                format: 'urn:x-nmos:format:data',
                caps: {
                    media_types: ['application/json']
                },
                tags: {
                    'urn:x-nmos:tag:is07/event_types': ['boolean', 'string', 'number', 'object'],
                    'urn:x-nmos:tag:is07/transport': node.transportMode === 'both' ? ['mqtt', 'websocket'] : 
                                                       node.transportMode === 'websocket' ? ['websocket'] : ['mqtt']
                },
                device_id: node.deviceId,
                transport: node.transportMode === 'websocket' ? 'urn:x-nmos:transport:websocket' : 'urn:x-nmos:transport:mqtt',
                interface_bindings: [ifaceName],
                subscription: {
                    sender_id: receiverConnectionState.active.sender_id,
                    active: receiverConnectionState.active.master_enable && receiverConnectionState.active.sender_id !== null
                }
            };

            return resource;
        };

        const buildSourceResource = () => {
            const resource = {
                id: node.statusSourceId,
                version: getTAITimestamp(),
                label: 'Endpoint Status Source',
                description: 'IS-07 Endpoint Status Source',
                format: 'urn:x-nmos:format:data',
                caps: {},
                tags: {
                    'urn:x-nmos:tag:is07/event_types': ['boolean', 'string', 'number', 'object']
                },
                device_id: node.deviceId,
                parents: [],
                clock_name: 'clk0'
            };

            return resource;
        };

        const buildFlowResource = () => {
            const resource = {
                id: node.flowId,
                version: getTAITimestamp(),
                label: node.flowLabel,
                description: `IS-07 Endpoint Flow - ${node.flowLabel}`,
                format: 'urn:x-nmos:format:data',
                tags: {
                    'urn:x-nmos:tag:is07/event_types': ['boolean', 'string', 'number', 'object']
                },
                source_id: node.statusSourceId,
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

            return resource;
        };

        const buildSenderResource = () => {
            const httpPort = node.registry.httpPort || 1880;
            const manifestUrl = `http://${localIP}:${httpPort}/x-nmos/events/manifest/${node.senderId}`;
            
            const resource = {
                id: node.senderId,
                version: getTAITimestamp(),
                label: node.senderLabel,
                description: `IS-07 Endpoint Sender - ${node.senderLabel}`,
                format: 'urn:x-nmos:format:data',
                caps: {
                    media_types: ['application/json']
                },
                tags: {
                    'urn:x-nmos:tag:is07/event_types': ['boolean', 'string', 'number', 'object'],
                    'urn:x-nmos:tag:is07/transport': node.transportMode === 'both' ? ['mqtt', 'websocket'] : 
                                                       node.transportMode === 'websocket' ? ['websocket'] : ['mqtt']
                },
                flow_id: node.flowId,
                device_id: node.deviceId,
                transport: node.transportMode === 'websocket' ? 'urn:x-nmos:transport:websocket' : 'urn:x-nmos:transport:mqtt',
                interface_bindings: [ifaceName],
                manifest_href: manifestUrl,
                subscription: {
                    receiver_id: senderConnectionState ? senderConnectionState.active.receiver_id : null,
                    active: senderConnectionState ? senderConnectionState.active.master_enable : true
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
                node.log('Starting IS-07 Endpoint Registration');
                node.log(`Registry: ${getRegistrationApiUrl()}`);
                node.log(`Sender enabled: ${node.enableSender}`);
                node.log('═══════════════════════════════════════');

                // Register Node
                const ok1 = await registerResource('node', buildNodeResource());
                if (!ok1) throw new Error('Node registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Register Device
                const ok2 = await registerResource('device', buildDeviceResource());
                if (!ok2) throw new Error('Device registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Register Source (if sender enabled)
                if (node.enableSender) {
                    const ok3 = await registerResource('source', buildSourceResource());
                    if (!ok3) throw new Error('Source registration failed');
                    await new Promise(r => setTimeout(r, 300));

                    // Register Flow
                    const ok4 = await registerResource('flow', buildFlowResource());
                    if (!ok4) throw new Error('Flow registration failed');
                    await new Promise(r => setTimeout(r, 300));

                    // Register Sender
                    const ok5 = await registerResource('sender', buildSenderResource());
                    if (!ok5) throw new Error('Sender registration failed');
                    await new Promise(r => setTimeout(r, 300));
                }

                // Register Receiver
                const ok6 = await registerResource('receiver', buildReceiverResource());
                if (!ok6) throw new Error('Receiver registration failed');

                registrationComplete = true;
                node.status({ fill: 'green', shape: 'dot', text: 'registered' });
                node.log('✓ IS-07 ENDPOINT REGISTERED');
                node.log('═══════════════════════════════════════');
                return true;

            } catch (err) {
                registrationComplete = false;
                node.status({ fill: 'red', shape: 'ring', text: 'registration failed' });
                node.error(`Registration failed: ${err.message}`);
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
                }
            } catch (err) {
                node.warn(`Heartbeat error: ${err.message}`);
            }
        }

        // ============================================================================
        // Status Update Publishing
        // ============================================================================

        const buildStatusGrain = (path, value) => {
            const timestamp = getTAITimestamp();
            return {
                grain_type: 'event',
                source_id: node.statusSourceId,
                flow_id: node.receiverId,
                origin_timestamp: timestamp,
                sync_timestamp: timestamp,
                creation_timestamp: timestamp,
                rate: { numerator: 0, denominator: 1 },
                duration: { numerator: 0, denominator: 1 },
                grain: {
                    type: 'urn:x-nmos:format:data.event',
                    topic: 'status',
                    data: [{
                        path: path,
                        pre: localState.get(path) || null,
                        post: value
                    }]
                }
            };
        };

        function publishStatus(path, value) {
            if (!node.sendStatusUpdates) {
                return false;
            }

            let published = false;

            // Publish via MQTT if enabled and connected
            if ((node.transportMode === 'mqtt' || node.transportMode === 'both') && 
                mqttClient && mqttClient.connected) {
                localState.set(path, value);
                const grain = buildStatusGrain(path, value);
                const topic = `x-nmos/events/1.0/${node.statusSourceId}/object`;

                mqttClient.publish(topic, JSON.stringify(grain), {
                    qos: node.mqttQos,
                    retain: false
                }, (err) => {
                    if (err) {
                        node.error(`MQTT publish error: ${err.message}`);
                    } else {
                        node.log(`► MQTT Status: ${path} = ${value}`);
                    }
                });
                published = true;
            }

            // Publish via WebSocket if enabled
            if (node.transportMode === 'websocket' || node.transportMode === 'both') {
                if (publishStatusWebSocket(path, value)) {
                    published = true;
                }
            }

            return published;
        }

        // ============================================================================
        // MQTT Functions
        // ============================================================================

        function setupMQTTClient() {
            const subscribeTopic = node.subscriptionFilter;

            node.log(`Connecting MQTT: ${node.mqttBroker}`);
            node.log(`Subscribe pattern: ${subscribeTopic}`);

            mqttClient = mqtt.connect(node.mqttBroker, {
                clientId: `nmos-is07-endpoint-${node.receiverId}`,
                clean: true,
                reconnectPeriod: 5000
            });

            mqttClient.on('connect', () => {
                node.log('✓ MQTT connected');
                const statusColor = registrationComplete ? 'green' : 'yellow';
                node.status({ fill: statusColor, shape: 'dot', text: 'connected' });

                mqttClient.subscribe(subscribeTopic, { qos: node.mqttQos }, (err) => {
                    if (err) {
                        node.error(`Subscribe error: ${err.message}`);
                    } else {
                        node.log(`✓ Subscribed: ${subscribeTopic}`);
                    }
                });
            });

            mqttClient.on('message', (topic, payloadBuffer) => {
                try {
                    const grain = JSON.parse(payloadBuffer.toString());
                    
                    // Don't process our own status updates
                    if (grain.source_id === node.statusSourceId) {
                        return;
                    }

                    node.log(`◄ Event from ${grain.source_id}`);

                    // Store received state
                    if (grain.grain && grain.grain.data) {
                        for (const item of grain.grain.data) {
                            const key = `${grain.source_id}/${item.path}`;
                            receivedStates.set(key, {
                                source_id: grain.source_id,
                                path: item.path,
                                value: item.post,
                                pre_value: item.pre,
                                timestamp: grain.origin_timestamp
                            });
                        }
                    }

                    // Parse Smartpanel commands if enabled
                    const smartpanelCommands = parseSmartpanelCommand(grain);

                    // Add to command history
                    const historyEntry = {
                        timestamp: new Date().toISOString(),
                        source_id: grain.source_id,
                        topic: topic,
                        grain_type: grain.grain_type,
                        commands: smartpanelCommands
                    };
                    commandHistory.unshift(historyEntry);
                    if (commandHistory.length > MAX_HISTORY) {
                        commandHistory.pop();
                    }

                    // Output message
                    const outputMsg = {
                        topic: topic,
                        payload: grain,
                        source_id: grain.source_id,
                        flow_id: grain.flow_id,
                        endpoint: {
                            device_id: node.deviceId,
                            receiver_id: node.receiverId
                        }
                    };

                    // Add parsed Smartpanel commands if available
                    if (smartpanelCommands && smartpanelCommands.length > 0) {
                        outputMsg.smartpanel = {
                            commands: smartpanelCommands,
                            raw_grain: grain
                        };
                    }

                    node.send(outputMsg);

                } catch (e) {
                    node.warn(`Invalid grain message: ${e.message}`);
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
                            receiverId: node.receiverId,
                            statusSourceId: node.statusSourceId,
                            enableSender: node.enableSender,
                            senderId: node.enableSender ? node.senderId : null,
                            flowId: node.enableSender ? node.flowId : null,
                            registered: registrationComplete,
                            mqttConnected: mqttClient && mqttClient.connected,
                            mqttBroker: node.mqttBroker,
                            subscriptionFilter: node.subscriptionFilter,
                            receivedSources: Array.from(new Set(Array.from(receivedStates.values()).map(s => s.source_id))),
                            receivedStatesCount: receivedStates.size,
                            localState: Object.fromEntries(localState),
                            registrationUrl: getRegistrationApiUrl(),
                            sendStatusUpdates: node.sendStatusUpdates,
                            parseSmartpanel: node.parseSmartpanel
                        };
                        node.send(msg);
                        break;

                    case 'get_received_states':
                        const states = Array.from(receivedStates.values());
                        msg.payload = {
                            states: states,
                            count: states.length,
                            sources: Array.from(new Set(states.map(s => s.source_id)))
                        };
                        node.send(msg);
                        break;

                    case 'get_command_history':
                        const limit = (msg.payload && msg.payload.limit) || 10;
                        msg.payload = {
                            history: commandHistory.slice(0, limit),
                            total: commandHistory.length
                        };
                        node.send(msg);
                        break;

                    case 'send_status':
                        const statusPath = msg.payload.path || msg.path;
                        const statusValue = msg.payload.value !== undefined ? msg.payload.value : msg.value;
                        if (!statusPath || statusValue === undefined) {
                            throw new Error('send_status requires path and value');
                        }
                        const statusOk = publishStatus(statusPath, statusValue);
                        msg.payload = { success: statusOk, action: 'send_status', path: statusPath, value: statusValue };
                        node.send(msg);
                        break;

                    case 'clear_history':
                        commandHistory.length = 0;
                        msg.payload = { success: true, action: 'clear_history' };
                        node.send(msg);
                        break;

                    case 'clear_states':
                        receivedStates.clear();
                        msg.payload = { success: true, action: 'clear_states' };
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
        // HTTP Manifest Endpoint
        // ============================================================================

        if (node.enableSender) {
            const manifestPath = `/x-nmos/events/manifest/${node.senderId}`;
            
            RED.httpNode.get(manifestPath, (req, res) => {
                const manifest = {
                    id: node.senderId,
                    version: getTAITimestamp(),
                    label: node.senderLabel,
                    description: `IS-07 Endpoint Sender Manifest`,
                    format: 'urn:x-nmos:format:data',
                    event_types: [
                        {
                            name: 'boolean',
                            description: 'Boolean state change event',
                            type: 'boolean'
                        },
                        {
                            name: 'string',
                            description: 'String state change event',
                            type: 'string'
                        },
                        {
                            name: 'number',
                            description: 'Number state change event',
                            type: 'number'
                        },
                        {
                            name: 'object',
                            description: 'Object state change event',
                            type: 'object'
                        }
                    ],
                    source_id: node.statusSourceId,
                    flow_id: node.flowId,
                    device_id: node.deviceId
                };

                res.setHeader('Content-Type', 'application/json');
                res.status(200).json(manifest);
                node.log(`◄ Manifest requested: ${manifestPath}`);
            });

            node.log(`✓ Manifest endpoint: http://${localIP}:${node.registry.httpPort || 1880}${manifestPath}`);
        }

        // ============================================================================
        // IS-05 Connection API Endpoints
        // ============================================================================

        const updateReceiverInRegistry = async () => {
            if (!registrationComplete) return;
            try {
                await registerResource('receiver', buildReceiverResource());
                node.log('✓ Receiver updated in registry');
            } catch (err) {
                node.warn(`Failed to update receiver: ${err.message}`);
            }
        };

        const updateSenderInRegistry = async () => {
            if (!registrationComplete || !node.enableSender) return;
            try {
                await registerResource('sender', buildSenderResource());
                node.log('✓ Sender updated in registry');
            } catch (err) {
                node.warn(`Failed to update sender: ${err.message}`);
            }
        };

        const setupConnectionAPI = () => {
            const connectionApiVersion = node.registry.connectionApiVersion || 'v1.0';
            
            // Receiver Connection API endpoints
            const receiverBasePath = `/x-nmos/connection/${connectionApiVersion}/single/receivers/${node.receiverId}`;
            
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
            
            // Receiver endpoints
            RED.httpNode.get(`${receiverBasePath}/staged`, middleware, (req, res) => {
                res.json(receiverConnectionState.staged);
            });
            
            RED.httpNode.patch(`${receiverBasePath}/staged`, middleware, (req, res) => {
                try {
                    const patch = req.body;
                    
                    if (patch.sender_id !== undefined) {
                        receiverConnectionState.staged.sender_id = patch.sender_id;
                    }
                    if (patch.master_enable !== undefined) {
                        receiverConnectionState.staged.master_enable = patch.master_enable;
                    }
                    if (patch.activation !== undefined) {
                        receiverConnectionState.staged.activation = {
                            ...receiverConnectionState.staged.activation,
                            ...patch.activation
                        };
                    }
                    if (patch.transport_params !== undefined) {
                        receiverConnectionState.staged.transport_params = patch.transport_params;
                    }
                    
                    if (patch.activation && patch.activation.mode === 'activate_immediate') {
                        receiverConnectionState.active = JSON.parse(JSON.stringify(receiverConnectionState.staged));
                        receiverConnectionState.active.activation.activation_time = getTAITimestamp();
                        
                        node.log(`✓ Receiver connection activated: ${receiverConnectionState.active.sender_id}`);
                        updateReceiverInRegistry();
                        
                        const msg = {
                            payload: {
                                event: 'receiver_connection_activated',
                                sender_id: receiverConnectionState.active.sender_id,
                                master_enable: receiverConnectionState.active.master_enable,
                                activation_time: receiverConnectionState.active.activation.activation_time
                            },
                            receiverId: node.receiverId,
                            topic: 'connection'
                        };
                        node.send(msg);
                    }
                    
                    res.json(receiverConnectionState.staged);
                } catch (error) {
                    res.status(400).json({
                        code: 400,
                        error: error.message,
                        debug: error.stack
                    });
                }
            });
            
            RED.httpNode.get(`${receiverBasePath}/active`, middleware, (req, res) => {
                res.json(receiverConnectionState.active);
            });
            
            RED.httpNode.get(`${receiverBasePath}/constraints`, middleware, (req, res) => {
                res.json(receiverConnectionState.constraints);
            });
            
            RED.httpNode.get(`${receiverBasePath}/transporttype`, middleware, (req, res) => {
                res.json(receiverConnectionState.transporttype);
            });
            
            node.log(`✓ IS-05 Receiver API: http://${localIP}:${node.registry.httpPort || 1880}${receiverBasePath}`);
            
            // Sender Connection API endpoints (if sender enabled)
            if (node.enableSender && senderConnectionState) {
                const senderBasePath = `/x-nmos/connection/${connectionApiVersion}/single/senders/${node.senderId}`;
                
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
            }
        };

        setupConnectionAPI();

        // ============================================================================
        // WebSocket Transport
        // ============================================================================

        function setupWebSocketServer() {
            try {
                node.log(`Starting WebSocket server on port ${node.wsPort}`);
                
                wsServer = new WebSocket.Server({ 
                    port: node.wsPort,
                    perMessageDeflate: false
                });

                wsServer.on('listening', () => {
                    node.log(`✓ WebSocket server listening on port ${node.wsPort}`);
                    node.log(`✓ WebSocket endpoint: ws://${localIP}:${node.wsPort}/`);
                    if (registrationComplete) {
                        node.status({fill: "green", shape: "dot", text: "WebSocket ready"});
                    }
                });

                wsServer.on('connection', (ws, req) => {
                    const clientId = req.socket.remoteAddress + ':' + req.socket.remotePort;
                    node.log(`✓ WebSocket client connected: ${clientId}`);
                    wsClients.add(ws);

                    ws.on('message', (data) => {
                        try {
                            const grain = JSON.parse(data.toString());
                            
                            // Don't process our own status updates
                            if (grain.source_id === node.statusSourceId) {
                                return;
                            }

                            node.log(`◄ WebSocket event from ${grain.source_id}`);

                            // Store received state
                            if (grain.grain && grain.grain.data) {
                                for (const item of grain.grain.data) {
                                    const key = `${grain.source_id}/${item.path}`;
                                    receivedStates.set(key, {
                                        source_id: grain.source_id,
                                        path: item.path,
                                        value: item.post,
                                        pre_value: item.pre,
                                        timestamp: grain.origin_timestamp
                                    });
                                }
                            }

                            // Parse Smartpanel commands if enabled
                            const smartpanelCommands = parseSmartpanelCommand(grain);

                            // Add to command history
                            const historyEntry = {
                                timestamp: new Date().toISOString(),
                                source_id: grain.source_id,
                                transport: 'websocket',
                                grain_type: grain.grain_type,
                                commands: smartpanelCommands
                            };
                            commandHistory.unshift(historyEntry);
                            if (commandHistory.length > MAX_HISTORY) {
                                commandHistory.pop();
                            }

                            // Output message
                            const outputMsg = {
                                topic: 'websocket',
                                payload: grain,
                                source_id: grain.source_id,
                                flow_id: grain.flow_id,
                                transport: 'websocket',
                                endpoint: {
                                    device_id: node.deviceId,
                                    receiver_id: node.receiverId
                                }
                            };

                            if (smartpanelCommands && smartpanelCommands.length > 0) {
                                outputMsg.smartpanel = {
                                    commands: smartpanelCommands,
                                    raw_grain: grain
                                };
                            }

                            node.send(outputMsg);

                        } catch (e) {
                            node.warn(`Invalid WebSocket message: ${e.message}`);
                        }
                    });

                    ws.on('close', () => {
                        node.log(`WebSocket client disconnected: ${clientId}`);
                        wsClients.delete(ws);
                    });

                    ws.on('error', (error) => {
                        node.error(`WebSocket client error: ${error.message}`);
                        wsClients.delete(ws);
                    });
                });

                wsServer.on('error', (error) => {
                    node.error(`WebSocket server error: ${error.message}`);
                    node.status({fill: "red", shape: "ring", text: "WebSocket error"});
                });

            } catch (error) {
                node.error(`WebSocket setup failed: ${error.message}`);
                node.status({fill: "red", shape: "ring", text: "WebSocket failed"});
            }
        }

        // Publish status via WebSocket
        function publishStatusWebSocket(path, value) {
            if (!node.enableSender || !wsServer || wsClients.size === 0) {
                return false;
            }

            localState.set(path, value);
            const grain = buildStatusGrain(path, value);
            const message = JSON.stringify(grain);

            let sent = 0;
            wsClients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                    sent++;
                }
            });

            if (sent > 0) {
                node.log(`► WebSocket Status: ${path} = ${value} (${sent} clients)`);
                return true;
            }
            return false;
        }

        // ============================================================================
        // Lifecycle
        // ============================================================================

        // Start transport(s)
        if (node.transportMode === 'mqtt' || node.transportMode === 'both') {
            setupMQTTClient();
        }
        if (node.transportMode === 'websocket' || node.transportMode === 'both') {
            setupWebSocketServer();
        }

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
            node.log('Shutting down IS-07 endpoint...');
            
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            
            if (mqttClient) {
                mqttClient.end(true);
            }

            if (wsServer) {
                wsClients.forEach(ws => {
                    try {
                        ws.close();
                    } catch (e) {
                        // Ignore errors on close
                    }
                });
                wsClients.clear();
                
                try {
                    wsServer.close();
                } catch (e) {
                    // Ignore errors on close
                }
            }

            (async () => {
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = node.registry.getAuthHeaders();
                try {
                    // Delete in reverse order: (Sender → Flow → Source if enabled) → Receiver → Device → Node
                    if (node.enableSender) {
                        await axios.delete(`${registrationApiUrl}/resource/senders/${node.senderId}`, { headers }).catch(() => {});
                        await axios.delete(`${registrationApiUrl}/resource/flows/${node.flowId}`, { headers }).catch(() => {});
                        await axios.delete(`${registrationApiUrl}/resource/sources/${node.statusSourceId}`, { headers }).catch(() => {});
                    }
                    await axios.delete(`${registrationApiUrl}/resource/receivers/${node.receiverId}`, { headers }).catch(() => {});
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

    RED.nodes.registerType('nmos-is07-endpoint', NMOSIS07EndpointNode);
};
