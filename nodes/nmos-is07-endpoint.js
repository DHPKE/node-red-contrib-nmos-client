/**
 * nodes/nmos-is07-endpoint.js
 * NMOS IS-07 Endpoint - Receive control commands and tally from IS-07 sources
 * Supports RIEDEL Smartpanel and other broadcast control systems
 */

const mqtt = require('mqtt');
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
        
        // Resource IDs
        node.nodeId = config.nodeId || uuidv4();
        node.deviceId = config.deviceId || uuidv4();
        node.receiverId = config.receiverId || uuidv4();

        let mqttClient = null;
        let registrationComplete = false;
        let heartbeatInterval = null;

        // State management
        const receivedStates = new Map(); // Track states from various sources
        const localState = new Map(); // Local endpoint state
        const commandHistory = []; // Track command history
        const MAX_HISTORY = 100;

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
                senders: [],
                receivers: [node.receiverId],
                tags: {
                    'urn:x-nmos:tag:is07/endpoint': ['true'],
                    'urn:x-nmos:tag:is07/role': ['receiver']
                }
            };

            if (node.registry.queryApiVersion >= 'v1.1') {
                resource.controls = [];
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
                    'urn:x-nmos:tag:is07/transport': ['mqtt']
                },
                device_id: node.deviceId,
                transport: 'urn:x-nmos:transport:mqtt',
                interface_bindings: [ifaceName],
                subscription: {
                    sender_id: null,
                    active: false
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
                node.log('═══════════════════════════════════════');

                // Register Node
                const ok1 = await registerResource('node', buildNodeResource());
                if (!ok1) throw new Error('Node registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Register Device
                const ok2 = await registerResource('device', buildDeviceResource());
                if (!ok2) throw new Error('Device registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Register Receiver
                const ok3 = await registerResource('receiver', buildReceiverResource());
                if (!ok3) throw new Error('Receiver registration failed');

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
            if (!node.sendStatusUpdates || !mqttClient || !mqttClient.connected) {
                return false;
            }

            localState.set(path, value);
            const grain = buildStatusGrain(path, value);
            const topic = `x-nmos/events/1.0/${node.statusSourceId}/object`;

            mqttClient.publish(topic, JSON.stringify(grain), {
                qos: node.mqttQos,
                retain: false
            }, (err) => {
                if (err) {
                    node.error(`Status publish error: ${err.message}`);
                } else {
                    node.log(`► Status: ${path} = ${value}`);
                }
            });

            return true;
        }

        /**
         * Write text to Smartpanel LCD display
         * Supports multiple LCD path formats for compatibility
         */
        function writeLCD(text, line = null) {
            if (!mqttClient || !mqttClient.connected) {
                node.warn('Cannot write LCD: MQTT not connected');
                return false;
            }

            if (!text && text !== '') {
                node.warn('Cannot write LCD: text is required');
                return false;
            }

            // Determine the LCD path based on whether a line number is specified
            let path;
            if (line !== null && line !== undefined) {
                // Write to specific line (e.g., lcd/line/1, lcd/line/2)
                path = `lcd/line/${line}`;
            } else {
                // Write to general LCD text path
                path = 'lcd/text';
            }

            // Build the IS-07 grain for LCD text
            const timestamp = getTAITimestamp();
            const grain = {
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
                    topic: 'lcd',
                    data: [{
                        path: path,
                        pre: localState.get(path) || null,
                        post: text
                    }]
                }
            };

            // Update local state
            localState.set(path, text);

            // Publish to MQTT
            const topic = `x-nmos/events/1.0/${node.statusSourceId}/string`;

            mqttClient.publish(topic, JSON.stringify(grain), {
                qos: node.mqttQos,
                retain: true  // Retain LCD text so new connections see it
            }, (err) => {
                if (err) {
                    node.error(`LCD write error: ${err.message}`);
                } else {
                    node.log(`► LCD: ${path} = "${text}"`);
                }
            });

            return true;
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

                    case 'write_lcd':
                        const lcdText = msg.payload.text !== undefined ? msg.payload.text : msg.text;
                        const lcdLine = msg.payload.line !== undefined ? msg.payload.line : msg.line;
                        if (lcdText === undefined && lcdText !== '') {
                            throw new Error('write_lcd requires text');
                        }
                        const lcdOk = writeLCD(lcdText, lcdLine);
                        msg.payload = { 
                            success: lcdOk, 
                            action: 'write_lcd', 
                            text: lcdText,
                            line: lcdLine !== null && lcdLine !== undefined ? lcdLine : 'all'
                        };
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
            node.log('Shutting down IS-07 endpoint...');
            
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
