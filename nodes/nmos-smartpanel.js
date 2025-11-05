/**
 * nodes/nmos-smartpanel.js
 * NMOS IS-07 Smartpanel Node - Complete Rewrite
 * 
 * Fully compliant AMWA NMOS IS-07 implementation for Riedel Smartpanel integration.
 * Supports bidirectional communication: receiving commands and sending button display updates.
 * 
 * Features:
 * - Full IS-07 grain structure parsing and generation
 * - IS-04 device registration with heartbeat
 * - Riedel Smartpanel command parsing (buttons, rotary encoders, GPIO, tally, faders)
 * - Button display text writing capability
 * - Command history tracking
 * - State management
 * 
 * @module nmos-smartpanel
 * @version 3.0.0
 */

const mqtt = require('mqtt');
const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

module.exports = function(RED) {
    /**
     * NMOS Smartpanel Node Constructor
     * @param {Object} config - Node configuration from Node-RED
     */
    function NMOSSmartpanelNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ============================================================================
        // Configuration
        // ============================================================================
        
        node.registry = RED.nodes.getNode(config.registry);
        node.mqttBroker = config.mqttBroker || 'mqtt://localhost:1883';
        node.mqttQos = parseInt(config.mqttQos) || 0;
        node.deviceLabel = config.deviceLabel || 'Riedel Smartpanel';
        node.deviceDescription = config.deviceDescription || 'NMOS IS-07 Smartpanel Interface';
        node.subscriptionFilter = config.subscriptionFilter || 'x-nmos/events/1.0/+/+';
        node.enableButtonDisplay = config.enableButtonDisplay !== false;
        node.autoParseCommands = config.autoParseCommands !== false;
        
        // Resource IDs - persisted in config
        node.nodeId = config.nodeId || uuidv4();
        node.deviceId = config.deviceId || uuidv4();
        node.sourceId = config.sourceId || uuidv4();
        node.receiverId = config.receiverId || uuidv4();

        // Runtime state
        let mqttClient = null;
        let registrationComplete = false;
        let heartbeatInterval = null;
        
        // State management
        const commandHistory = [];
        const MAX_HISTORY = 100;
        const buttonDisplayStates = new Map(); // Track button text states
        const receivedSourceIds = new Set(); // Track source IDs we've seen

        // Validate configuration
        if (!node.registry) {
            node.error('No NMOS registry configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no registry' });
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

        /**
         * Get network interface information
         * @returns {Object} Network info with ip, mac, and interface name
         */
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
         * TAI = UTC + 37 seconds (as of 2017, valid through 2024)
         * Reference: https://www.ietf.org/timezones/data/leap-seconds.list
         * 
         * @returns {string} TAI timestamp in format "seconds:nanoseconds"
         */
        const getTAITimestamp = () => {
            const now = Date.now() / 1000;
            const taiSeconds = Math.floor(now) + 37; // TAI offset
            const taiNanoseconds = Math.floor((now % 1) * 1e9);
            return `${taiSeconds}:${String(taiNanoseconds).padStart(9, '0')}`;
        };

        /**
         * Get IS-04 Registration API URL
         * @returns {string} Registration API base URL
         */
        const getRegistrationApiUrl = () => {
            return `${node.registry.registryUrl}/x-nmos/registration/${node.registry.queryApiVersion}`;
        };

        // ============================================================================
        // IS-07 Grain Parsing
        // ============================================================================

        /**
         * Validate IS-07 grain structure
         * @param {Object} grain - The grain to validate
         * @returns {boolean} True if grain is valid
         */
        const validateIS07Grain = (grain) => {
            if (!grain || typeof grain !== 'object') return false;
            if (!grain.grain_type) return false;
            if (!grain.source_id) return false;
            if (!grain.flow_id) return false;
            if (!grain.origin_timestamp) return false;
            if (!grain.data || !Array.isArray(grain.data)) return false;
            return true;
        };

        /**
         * Parse Smartpanel commands from IS-07 grain
         * Supports multiple command types: buttons, rotary encoders, GPIO, tally, faders
         * 
         * @param {Object} grain - IS-07 grain message
         * @returns {Array} Array of parsed command objects
         */
        const parseSmartpanelGrain = (grain) => {
            if (!node.autoParseCommands || !validateIS07Grain(grain)) {
                return [];
            }

            const commands = [];
            const data = grain.data;

            for (const item of data) {
                const path = item.path || '';
                const value = item.post;
                const preValue = item.pre;

                const command = {
                    timestamp: grain.origin_timestamp,
                    raw_path: path,
                    raw_value: value,
                    pre_value: preValue
                };

                // ========== Button Commands ==========
                // Patterns: button/{index}, key/{index}, switch/{index}
                if (path.match(/^(button|key|switch)\/(\d+)$/i)) {
                    const match = path.match(/(\d+)$/);
                    if (match) {
                        command.type = 'button';
                        command.button = parseInt(match[1]);
                        command.pressed = !!value;
                        command.index = command.button;
                    }
                }
                
                // ========== Rotary Encoder Commands ==========
                // Patterns: rotary/{index}, encoder/{index}, knob/{index}
                else if (path.match(/^(rotary|encoder|knob)\/(\d+)$/i)) {
                    const match = path.match(/(\d+)$/);
                    if (match) {
                        command.type = 'rotary';
                        command.encoder = parseInt(match[1]);
                        command.index = command.encoder;
                        command.value = parseFloat(value) || 0;
                        
                        // Calculate delta if we have pre value
                        if (preValue !== undefined && preValue !== null) {
                            command.delta = command.value - parseFloat(preValue);
                            command.direction = command.delta > 0 ? 'clockwise' : 
                                              command.delta < 0 ? 'counterclockwise' : 'none';
                        }
                        
                        // Interpret as normalized position (0.0 to 1.0)
                        command.position = Math.max(0, Math.min(1, command.value));
                    }
                }
                
                // ========== GPIO/GPI Commands ==========
                // Patterns: gpio/input/{index}, gpi/{index}
                else if (path.match(/^gpi?o?\/(input|in)\/(\d+)$/i)) {
                    const match = path.match(/(\d+)$/);
                    if (match) {
                        command.type = 'gpio';
                        command.gpio = parseInt(match[1]);
                        command.index = command.gpio;
                        command.state = !!value;
                    }
                }
                
                // ========== Tally Commands ==========
                // Patterns: tally/red, tally/green, tally/amber, tally/program, tally/preview
                else if (path.match(/^tally\/(red|green|amber|yellow|program|preview|white)$/i)) {
                    const match = path.match(/\/(red|green|amber|yellow|program|preview|white)$/i);
                    if (match) {
                        command.type = 'tally';
                        command.color = match[1].toLowerCase();
                        command.state = !!value;
                    }
                }
                
                // ========== Fader/Level Commands ==========
                // Patterns: fader/{index}, level/{index}, gain/{index}
                else if (path.match(/^(fader|level|gain)\/(\d+)$/i)) {
                    const match = path.match(/(\d+)$/);
                    if (match) {
                        command.type = 'fader';
                        command.fader = parseInt(match[1]);
                        command.index = command.fader;
                        command.value = parseFloat(value) || 0;
                        command.normalized = Math.max(0, Math.min(1, command.value));
                    }
                }
                
                // ========== Generic Property ==========
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
        // IS-07 Grain Building (for sending)
        // ============================================================================

        /**
         * Build IS-07 grain for button text display
         * @param {number} button - Button index (1-based)
         * @param {string} text - Text to display
         * @param {string} color - Optional color (red, green, amber, white)
         * @returns {Object} IS-07 grain message
         */
        const buildButtonTextGrain = (button, text, color) => {
            const timestamp = getTAITimestamp();
            const path = `display/button/${button}/text`;
            
            const grain = {
                grain_type: 'event',
                source_id: node.sourceId,
                flow_id: node.sourceId, // Using source_id as flow_id for simplicity
                origin_timestamp: timestamp,
                sync_timestamp: timestamp,
                creation_timestamp: timestamp,
                rate: { numerator: 0, denominator: 1 },
                duration: { numerator: 0, denominator: 1 },
                grain: {
                    type: 'urn:x-nmos:format:data.event',
                    topic: `x-nmos/events/1.0/${node.sourceId}/string`,
                    data: [
                        {
                            path: path,
                            pre: buttonDisplayStates.get(button) || '',
                            post: text
                        }
                    ]
                }
            };

            // Add color if specified
            if (color) {
                grain.grain.data.push({
                    path: `display/button/${button}/color`,
                    pre: null,
                    post: color
                });
            }

            // Update state
            buttonDisplayStates.set(button, text);

            return grain;
        };

        /**
         * Build IS-07 grain for multiple button updates
         * @param {Array} buttons - Array of {button, text, color} objects
         * @returns {Object} IS-07 grain message
         */
        const buildMultiButtonGrain = (buttons) => {
            const timestamp = getTAITimestamp();
            const data = [];

            for (const btn of buttons) {
                data.push({
                    path: `display/button/${btn.button}/text`,
                    pre: buttonDisplayStates.get(btn.button) || '',
                    post: btn.text
                });

                if (btn.color) {
                    data.push({
                        path: `display/button/${btn.button}/color`,
                        pre: null,
                        post: btn.color
                    });
                }

                buttonDisplayStates.set(btn.button, btn.text);
            }

            return {
                grain_type: 'event',
                source_id: node.sourceId,
                flow_id: node.sourceId,
                origin_timestamp: timestamp,
                sync_timestamp: timestamp,
                creation_timestamp: timestamp,
                rate: { numerator: 0, denominator: 1 },
                duration: { numerator: 0, denominator: 1 },
                grain: {
                    type: 'urn:x-nmos:format:data.event',
                    topic: `x-nmos/events/1.0/${node.sourceId}/string`,
                    data: data
                }
            };
        };

        // ============================================================================
        // IS-04 Resource Builders
        // ============================================================================

        /**
         * Build IS-04 Node resource
         * @returns {Object} Node resource
         */
        const buildNodeResource = () => {
            return {
                id: node.nodeId,
                version: getTAITimestamp(),
                label: `${node.deviceLabel} Node`,
                description: node.deviceDescription,
                href: `http://${localIP}:${node.registry.httpPort || 1880}/`,
                hostname: os.hostname(),
                caps: {},
                tags: {
                    'urn:x-nmos:tag:is07/role': ['smartpanel', 'endpoint']
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
                }],
                services: []
            };
        };

        /**
         * Build IS-04 Device resource
         * @returns {Object} Device resource
         */
        const buildDeviceResource = () => {
            return {
                id: node.deviceId,
                version: getTAITimestamp(),
                label: node.deviceLabel,
                description: node.deviceDescription,
                type: 'urn:x-nmos:device:generic',
                node_id: node.nodeId,
                senders: node.enableButtonDisplay ? [node.sourceId] : [],
                receivers: [node.receiverId],
                tags: {
                    'urn:x-nmos:tag:is07/smartpanel': ['true'],
                    'urn:x-nmos:tag:manufacturer': ['Riedel']
                },
                controls: []
            };
        };

        /**
         * Build IS-04 Source resource (for status feedback)
         * @returns {Object} Source resource
         */
        const buildSourceResource = () => {
            return {
                id: node.sourceId,
                version: getTAITimestamp(),
                label: `${node.deviceLabel} Status`,
                description: 'Smartpanel button display updates',
                format: 'urn:x-nmos:format:data',
                caps: {},
                tags: {
                    'urn:x-nmos:tag:is07/event_type': ['string']
                },
                device_id: node.deviceId,
                parents: [],
                clock_name: 'clk0',
                grain_rate: { numerator: 0, denominator: 1 }
            };
        };

        /**
         * Build IS-04 Receiver resource (for command reception)
         * @returns {Object} Receiver resource
         */
        const buildReceiverResource = () => {
            return {
                id: node.receiverId,
                version: getTAITimestamp(),
                label: `${node.deviceLabel} Commands`,
                description: 'Smartpanel command receiver',
                format: 'urn:x-nmos:format:data',
                caps: {
                    media_types: ['application/json']
                },
                tags: {
                    'urn:x-nmos:tag:is07/receiver': ['true']
                },
                device_id: node.deviceId,
                transport: 'urn:x-nmos:transport:mqtt',
                subscription: {
                    sender_id: null,
                    active: true
                },
                interface_bindings: [ifaceName]
            };
        };

        // ============================================================================
        // IS-04 Registration
        // ============================================================================

        /**
         * Register a single resource with the IS-04 registry
         * @param {string} type - Resource type (node, device, source, receiver)
         * @param {Object} data - Resource data
         * @returns {Promise<boolean>} True if registration successful
         */
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

        /**
         * Register all IS-04 resources
         * @returns {Promise<boolean>} True if all registrations successful
         */
        async function registerWithRegistry() {
            node.status({ fill: 'blue', shape: 'dot', text: 'registering...' });
            
            try {
                node.log('═══════════════════════════════════════');
                node.log('Starting Smartpanel IS-04 Registration');
                node.log(`Registry: ${getRegistrationApiUrl()}`);
                node.log(`API Version: ${node.registry.queryApiVersion}`);
                node.log('═══════════════════════════════════════');

                // Register Node
                if (!await registerResource('node', buildNodeResource())) {
                    throw new Error('Node registration failed');
                }
                await new Promise(r => setTimeout(r, 300));

                // Register Device
                if (!await registerResource('device', buildDeviceResource())) {
                    throw new Error('Device registration failed');
                }
                await new Promise(r => setTimeout(r, 300));

                // Register Source (if button display enabled)
                if (node.enableButtonDisplay) {
                    if (!await registerResource('source', buildSourceResource())) {
                        throw new Error('Source registration failed');
                    }
                    await new Promise(r => setTimeout(r, 300));
                }

                // Register Receiver
                if (!await registerResource('receiver', buildReceiverResource())) {
                    throw new Error('Receiver registration failed');
                }

                registrationComplete = true;
                node.log('═══════════════════════════════════════');
                node.log('✓ ALL RESOURCES REGISTERED');
                node.log('═══════════════════════════════════════');
                return true;

            } catch (err) {
                registrationComplete = false;
                node.error(`Registration failed: ${err.message}`);
                node.log('═══════════════════════════════════════');
                return false;
            }
        }

        /**
         * Send IS-04 heartbeat to maintain registration
         */
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
                    await registerWithRegistry();
                } else {
                    node.warn(`Heartbeat unexpected status: ${res.status}`);
                }
            } catch (err) {
                node.warn(`Heartbeat error: ${err.message}`);
            }
        }

        // ============================================================================
        // MQTT Communication
        // ============================================================================

        /**
         * Setup and connect MQTT client
         */
        function setupMQTTClient() {
            node.status({ fill: 'yellow', shape: 'dot', text: 'connecting mqtt...' });

            try {
                mqttClient = mqtt.connect(node.mqttBroker, {
                    clientId: `nmos-smartpanel-${node.deviceId}`,
                    clean: true,
                    reconnectPeriod: 5000,
                    connectTimeout: 30000
                });

                mqttClient.on('connect', () => {
                    node.log('MQTT connected');
                    node.status({ fill: 'yellow', shape: 'dot', text: 'mqtt connected' });

                    // Subscribe to command topics
                    mqttClient.subscribe(node.subscriptionFilter, { qos: node.mqttQos }, (err) => {
                        if (err) {
                            node.error(`MQTT subscribe error: ${err.message}`);
                        } else {
                            node.log(`Subscribed to: ${node.subscriptionFilter}`);
                            
                            // Start IS-04 registration after MQTT is ready
                            registerWithRegistry().then(success => {
                                if (success) {
                                    node.status({ fill: 'green', shape: 'dot', text: 'operational' });
                                    
                                    // Start heartbeat
                                    heartbeatInterval = setInterval(sendHeartbeat, 5000);
                                } else {
                                    node.status({ fill: 'yellow', shape: 'dot', text: 'mqtt only' });
                                }
                            });
                        }
                    });
                });

                mqttClient.on('message', handleMQTTMessage);

                mqttClient.on('error', (err) => {
                    node.error(`MQTT error: ${err.message}`);
                    node.status({ fill: 'red', shape: 'ring', text: 'mqtt error' });
                });

                mqttClient.on('close', () => {
                    node.warn('MQTT connection closed');
                    node.status({ fill: 'yellow', shape: 'ring', text: 'mqtt disconnected' });
                });

                mqttClient.on('reconnect', () => {
                    node.log('MQTT reconnecting...');
                    node.status({ fill: 'yellow', shape: 'dot', text: 'reconnecting...' });
                });

            } catch (err) {
                node.error(`MQTT setup error: ${err.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'mqtt setup failed' });
            }
        }

        /**
         * Handle incoming MQTT messages
         * @param {string} topic - MQTT topic
         * @param {Buffer} payload - Message payload
         */
        function handleMQTTMessage(topic, payload) {
            node.status({ fill: 'blue', shape: 'ring', text: 'processing' });

            try {
                // Parse IS-07 grain
                const grain = JSON.parse(payload.toString());

                // Validate grain structure
                if (!validateIS07Grain(grain)) {
                    node.warn(`Invalid IS-07 grain received on topic: ${topic}`);
                    node.status({ fill: 'green', shape: 'dot', text: 'operational' });
                    return;
                }

                // Track source ID
                receivedSourceIds.add(grain.source_id);

                // Parse Smartpanel commands
                const commands = parseSmartpanelGrain(grain);

                // Add to command history
                if (commands.length > 0) {
                    for (const cmd of commands) {
                        commandHistory.unshift({
                            ...cmd,
                            received_at: new Date().toISOString(),
                            topic: topic,
                            source_id: grain.source_id
                        });
                    }
                    
                    // Limit history size
                    while (commandHistory.length > MAX_HISTORY) {
                        commandHistory.pop();
                    }
                }

                // Build output message
                const msg = {
                    topic: topic,
                    payload: grain,
                    source_id: grain.source_id,
                    grain_timestamp: grain.origin_timestamp
                };

                // Add parsed commands if any
                if (commands.length > 0) {
                    msg.smartpanel = {
                        commands: commands
                    };
                }

                // Send output
                node.send(msg);

                node.status({ fill: 'green', shape: 'dot', text: 'operational' });

            } catch (err) {
                node.error(`Error processing MQTT message: ${err.message}`);
                node.status({ fill: 'green', shape: 'dot', text: 'operational' });
            }
        }

        /**
         * Publish button display text updates
         * @param {Array} buttons - Array of button configurations
         */
        function publishButtonText(buttons) {
            if (!mqttClient || !mqttClient.connected) {
                node.error('Cannot publish: MQTT not connected');
                return;
            }

            if (!node.enableButtonDisplay) {
                node.warn('Button display not enabled in configuration');
                return;
            }

            try {
                const grain = buildMultiButtonGrain(buttons);
                const topic = `x-nmos/events/1.0/${node.sourceId}/string`;
                const payload = JSON.stringify(grain);

                mqttClient.publish(topic, payload, { qos: node.mqttQos }, (err) => {
                    if (err) {
                        node.error(`Failed to publish button text: ${err.message}`);
                    } else {
                        node.log(`Published button text to ${buttons.length} button(s)`);
                    }
                });

            } catch (err) {
                node.error(`Error building button text grain: ${err.message}`);
            }
        }

        // ============================================================================
        // Input Message Handling
        // ============================================================================

        /**
         * Handle input messages for various actions
         */
        node.on('input', (msg) => {
            const action = msg.action || msg.payload?.action;

            try {
                switch (action) {
                    case 'get_state':
                        // Return current node state
                        msg.payload = {
                            node_id: node.nodeId,
                            device_id: node.deviceId,
                            source_id: node.sourceId,
                            receiver_id: node.receiverId,
                            mqtt_connected: mqttClient?.connected || false,
                            registered: registrationComplete,
                            button_display_enabled: node.enableButtonDisplay,
                            auto_parse_enabled: node.autoParseCommands,
                            command_history_size: commandHistory.length,
                            known_sources: Array.from(receivedSourceIds),
                            button_states: Object.fromEntries(buttonDisplayStates)
                        };
                        node.send(msg);
                        break;

                    case 'get_command_history':
                        // Return command history
                        msg.payload = {
                            commands: commandHistory,
                            total: commandHistory.length
                        };
                        node.send(msg);
                        break;

                    case 'clear_history':
                        // Clear command history
                        commandHistory.length = 0;
                        msg.payload = { status: 'history cleared' };
                        node.send(msg);
                        break;

                    case 'set_button_text':
                        // Set single button text
                        const button = msg.button || msg.payload?.button;
                        const text = msg.text || msg.payload?.text;
                        const color = msg.color || msg.payload?.color;

                        if (!button || text === undefined) {
                            node.error('set_button_text requires button and text');
                            return;
                        }

                        publishButtonText([{ button, text, color }]);
                        break;

                    case 'set_multiple_buttons':
                        // Set multiple buttons
                        const buttons = msg.buttons || msg.payload?.buttons;

                        if (!buttons || !Array.isArray(buttons)) {
                            node.error('set_multiple_buttons requires buttons array');
                            return;
                        }

                        publishButtonText(buttons);
                        break;

                    case 'send_status':
                        // Send custom IS-07 event
                        const customGrain = msg.grain || msg.payload?.grain;
                        
                        if (!customGrain) {
                            node.error('send_status requires grain object');
                            return;
                        }

                        const topic = msg.topic || `x-nmos/events/1.0/${node.sourceId}/string`;
                        
                        if (mqttClient && mqttClient.connected) {
                            mqttClient.publish(topic, JSON.stringify(customGrain), { qos: node.mqttQos });
                        } else {
                            node.error('Cannot send status: MQTT not connected');
                        }
                        break;

                    default:
                        node.warn(`Unknown action: ${action}`);
                        break;
                }

            } catch (err) {
                node.error(`Error handling input: ${err.message}`);
            }
        });

        // ============================================================================
        // Node Lifecycle
        // ============================================================================

        // Initialize
        setupMQTTClient();

        // Cleanup on node close
        node.on('close', (done) => {
            node.log('Shutting down Smartpanel node...');

            // Clear heartbeat
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }

            // Disconnect MQTT
            if (mqttClient) {
                mqttClient.end(false, {}, () => {
                    node.log('MQTT disconnected');
                    done();
                });
            } else {
                done();
            }
        });
    }

    // Register node with Node-RED
    RED.nodes.registerType('nmos-smartpanel', NMOSSmartpanelNode);
};
