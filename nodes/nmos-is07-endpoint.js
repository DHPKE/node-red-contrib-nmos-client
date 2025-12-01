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
        
        // SmartPanel configuration
        node.smartpanelIp = config.smartpanelIp || '';
        node.smartpanelPort = config.smartpanelPort || 0;
        node.displayMappings = config.displayMappings || [];
        node.controlMappings = config.controlMappings || {};
        
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
                // Parse SmartPanel LeverKey Up/Down
                else if (path.match(/^(leverkey|lever)\/(\d+)\/(up|down)$/i)) {
                    const match = path.match(/^(leverkey|lever)\/(\d+)\/(up|down)$/i);
                    if (match) {
                        command.type = 'leverkey';
                        command.leverkey = parseInt(match[2]);
                        command.direction = match[3].toLowerCase();
                        command.state = !!value;
                    }
                }
                // Parse SmartPanel Rotary controls
                else if (path.match(/^rotary\/(\d+)\/(push|left|right)$/i)) {
                    const match = path.match(/^rotary\/(\d+)\/(push|left|right)$/i);
                    if (match) {
                        command.type = 'rotary';
                        command.rotary = parseInt(match[1]);
                        command.action = match[2].toLowerCase();
                        command.value = value;
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
            const payload = data;

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
         * Get display ID from name mapping
         * @param {string} displayName - Friendly display name
         * @returns {string|null} Display ID or null if not found
         */
        function getDisplayId(displayName) {
            if (!displayName) return null;
            
            // If it's already a numeric ID, use it directly
            if (!isNaN(displayName)) return displayName.toString();
            
            // Look up in mappings
            const mapping = node.displayMappings.find(m => m.name === displayName);
            return mapping ? mapping.id : displayName; // Fallback to name if not found
        }

        /**
         * Validate display name/ID
         * @param {string} displayNameOrId - Display name or ID
         * @returns {object} Validation result {valid: boolean, displayId: string, error: string}
         */
        function validateDisplay(displayNameOrId) {
            if (!displayNameOrId) {
                return { valid: false, error: 'Display name or ID is required' };
            }

            const displayId = getDisplayId(displayNameOrId);
            if (!displayId) {
                return { valid: false, error: `Display '${displayNameOrId}' not found in mappings` };
            }

            return { valid: true, displayId: displayId };
        }

        /**
         * Send display text to SmartPanel (Enhanced version)
         * @param {string|number} displayNameOrId - Display name or numeric ID
         * @param {string} text - Text to display
         * @param {object} options - Optional display options (scroll, align, color, brightness)
         * @returns {object} Result {success: boolean, displayId: string, error: string}
         */
        function sendDisplayText(displayNameOrId, text, options = {}) {
            if (!mqttClient || !mqttClient.connected) {
                node.warn('Cannot send display text: MQTT not connected');
                return { success: false, error: 'MQTT not connected' };
            }

            // Validate display
            const validation = validateDisplay(displayNameOrId);
            if (!validation.valid) {
                node.warn(`Display validation failed: ${validation.error}`);
                return { success: false, error: validation.error };
            }

            const displayId = validation.displayId;
            const displayPath = `display/${displayId}/text`;
            const displayData = {
                text: text,
                color: options.color || 'white',
                brightness: options.brightness || 100,
                scroll: options.scroll || false,
                align: options.align || 'left',
                timestamp: new Date().toISOString()
            };

            const grain = buildStatusGrain(displayPath, displayData);
            const topic = `x-nmos/events/1.0/${node.statusSourceId}/object`;

            mqttClient.publish(topic, JSON.stringify(grain), {
                qos: node.mqttQos,
                retain: false
            }, (err) => {
                if (err) {
                    node.error(`Display text publish error: ${err.message}`);
                } else {
                    node.log(`► Display ${displayId}: ${text}`);
                    node.status({ 
                        fill: 'green', 
                        shape: 'dot', 
                        text: `display: ${text.substring(0, 20)}${text.length > 20 ? '...' : ''}` 
                    });
                }
            });

            return { success: true, displayId: displayId };
        }

        /**
         * Send display text to multiple displays
         * @param {object} displays - Object mapping display names to text {displayName: text, ...}
         * @param {object} options - Optional display options applied to all
         * @returns {object} Result {success: boolean, updates: array, errors: array}
         */
        function sendMultipleDisplayTexts(displays, options = {}) {
            const results = { success: true, updates: [], errors: [] };
            
            for (const [displayName, text] of Object.entries(displays)) {
                const result = sendDisplayText(displayName, text, options);
                if (result.success) {
                    results.updates.push({ display: displayName, displayId: result.displayId, text });
                } else {
                    results.errors.push({ display: displayName, error: result.error });
                    results.success = false;
                }
            }
            
            return results;
        }

        /**
         * Configure SmartPanel routing
         * @param {string} panelId - SmartPanel identifier
         * @param {object} routingConfig - Routing configuration
         */
        function configureSmartPanelRouting(panelId, routingConfig) {
            if (!mqttClient || !mqttClient.connected) {
                return false;
            }

            const routingPath = `smartpanel/${panelId}/routing`;
            const grain = buildStatusGrain(routingPath, routingConfig);
            const topic = `x-nmos/events/1.0/${node.statusSourceId}/object`;

            mqttClient.publish(topic, JSON.stringify(grain), {
                qos: node.mqttQos,
                retain: false
            }, (err) => {
                if (err) {
                    node.error(`SmartPanel routing config error: ${err.message}`);
                } else {
                    node.log(`► SmartPanel routing configured: ${panelId}`);
                }
            });

            return true;
        }

        /**
         * Create standardized control event message from parsed command
         * @param {object} cmd - Parsed SmartPanel command
         * @returns {object|null} Control event message or null
         */
        function createControlEventMessage(cmd) {
            if (!cmd || !cmd.type) return null;

            let event = null;
            let control = null;

            // Map command types to event names
            if (cmd.type === 'leverkey') {
                event = cmd.direction === 'up' ? 'leverkey_up' : 'leverkey_down';
                control = node.controlMappings[`leverkey${cmd.leverkey}`] || `lever${cmd.leverkey}`;
            } else if (cmd.type === 'rotary') {
                if (cmd.action === 'push') {
                    event = 'rotary_push';
                } else if (cmd.action === 'left') {
                    event = 'rotary_left';
                } else if (cmd.action === 'right') {
                    event = 'rotary_right';
                }
                control = node.controlMappings[`rotary${cmd.rotary}`] || `rotary${cmd.rotary}`;
            } else if (cmd.type === 'button') {
                event = cmd.pressed ? 'button_press' : 'button_release';
                control = node.controlMappings[`button${cmd.button}`] || `button${cmd.button}`;
            } else if (cmd.type === 'gpio') {
                event = cmd.state ? 'gpio_high' : 'gpio_low';
                control = node.controlMappings[`gpio${cmd.gpio}`] || `gpio${cmd.gpio}`;
            }

            if (!event) return null;

            return {
                topic: 'smartpanel/control',
                payload: {
                    event: event,
                    control: control,
                    timestamp: new Date().toISOString(),
                    value: cmd.value,
                    raw_command: cmd
                }
            };
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
                        
                        // Emit standardized control event messages for each command
                        for (const cmd of smartpanelCommands) {
                            const controlEvent = createControlEventMessage(cmd);
                            if (controlEvent) {
                                node.send(controlEvent);
                            }
                        }
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
                // Check for simplified display text formats first
                if (msg.payload && !msg.payload.action) {
                    // Single display update: {display: "name", text: "...", ...}
                    if (msg.payload.display && msg.payload.text) {
                        const options = {
                            color: msg.payload.color,
                            brightness: msg.payload.brightness,
                            scroll: msg.payload.scroll,
                            align: msg.payload.align
                        };
                        const result = sendDisplayText(msg.payload.display, msg.payload.text, options);
                        msg.payload = result;
                        node.send(msg);
                        return;
                    }
                    
                    // Multiple displays: {displays: {name1: "text1", name2: "text2"}}
                    if (msg.payload.displays && typeof msg.payload.displays === 'object') {
                        const options = {
                            color: msg.payload.color,
                            brightness: msg.payload.brightness,
                            scroll: msg.payload.scroll,
                            align: msg.payload.align
                        };
                        const result = sendMultipleDisplayTexts(msg.payload.displays, options);
                        msg.payload = result;
                        node.send(msg);
                        return;
                    }
                }

                const action = (msg.payload && msg.payload.action) || msg.action;

                if (!action) {
                    node.warn('No action specified in message. Use msg.payload.action or simplified display format.');
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
                            parseSmartpanel: node.parseSmartpanel,
                            smartpanelIp: node.smartpanelIp,
                            smartpanelPort: node.smartpanelPort,
                            displayMappings: node.displayMappings
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

                    case 'send_display_text':
                        const displayId = msg.payload.displayId || msg.payload.display || msg.displayId;
                        const displayText = msg.payload.text || msg.text;
                        const displayOptions = {
                            color: msg.payload.color || (msg.payload.options && msg.payload.options.color),
                            brightness: msg.payload.brightness || (msg.payload.options && msg.payload.options.brightness),
                            scroll: msg.payload.scroll || (msg.payload.options && msg.payload.options.scroll),
                            align: msg.payload.align || (msg.payload.options && msg.payload.options.align)
                        };
                        if (!displayId || !displayText) {
                            throw new Error('send_display_text requires displayId/display and text');
                        }
                        const displayResult = sendDisplayText(displayId, displayText, displayOptions);
                        msg.payload = displayResult;
                        node.send(msg);
                        break;

                    case 'configure_smartpanel_routing':
                        const panelId = msg.payload.panelId || msg.panelId;
                        const routingConfig = msg.payload.routingConfig || msg.routingConfig;
                        if (!panelId || !routingConfig) {
                            throw new Error('configure_smartpanel_routing requires panelId and routingConfig');
                        }
                        const routingOk = configureSmartPanelRouting(panelId, routingConfig);
                        msg.payload = { 
                            success: routingOk, 
                            action: 'configure_smartpanel_routing', 
                            panelId: panelId 
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
