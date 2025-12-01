/**
 * nodes/nmos-riedel-artist.js
 * NMOS RIEDEL Artist - Intercom matrix control and panel management via NMOS
 * Supports Artist intercom matrix functionality including panel registration,
 * key assignments, audio routing, and status monitoring
 */

const mqtt = require('mqtt');
const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

module.exports = function(RED) {
    function NMOSRiedelArtistNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.registry = RED.nodes.getNode(config.registry);
        node.mqttBroker = config.mqttBroker || 'mqtt://localhost:1883';
        node.deviceLabel = config.deviceLabel || 'RIEDEL Artist Panel';
        node.deviceDescription = config.deviceDescription || 'Artist intercom panel via NMOS';
        node.panelLabel = config.panelLabel || 'Artist Panel';
        node.panelType = config.panelType || 'generic'; // generic, 1100, 2300, smartpanel
        node.mqttQos = parseInt(config.mqttQos) || 1;
        node.enableAudioRouting = config.enableAudioRouting !== false;
        node.enableKeyControl = config.enableKeyControl !== false;
        node.matrixSourceId = config.matrixSourceId || uuidv4();
        node.smartpanelPreset = config.smartpanelPreset || null; // RSP-1216HL, RSP-1232HL, or null
        
        // Resource IDs
        node.nodeId = config.nodeId || uuidv4();
        node.deviceId = config.deviceId || uuidv4();
        node.senderId = config.senderId || uuidv4();
        node.receiverId = config.receiverId || uuidv4();

        let mqttClient = null;
        let registrationComplete = false;
        let heartbeatInterval = null;

        // Artist panel state management
        const panelState = {
            keys: new Map(),           // Key assignments and states
            audioRoutes: new Map(),    // Active audio routes
            panelStatus: {
                connected: false,
                registered: false,
                lastUpdate: null
            },
            matrixConfig: {
                inputs: [],
                outputs: [],
                crosspoints: new Map()
            }
        };

        const commandHistory = [];
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
        // SmartPanel Preset Configurations
        // ============================================================================

        const SMARTPANEL_PRESETS = {
            'RSP-1216HL': {
                model: 'RSP-1216HL',
                keys: 16,
                rotaries: 4,
                displays: 4,
                leverkeys: 8,
                keyMapping: {
                    1: { type: 'button', led: true, display: 1 },
                    2: { type: 'button', led: true, display: 1 },
                    3: { type: 'button', led: true, display: 1 },
                    4: { type: 'button', led: true, display: 1 },
                    5: { type: 'leverkey', led: true, display: 2 },
                    6: { type: 'leverkey', led: true, display: 2 },
                    7: { type: 'button', led: true, display: 2 },
                    8: { type: 'button', led: true, display: 2 },
                    9: { type: 'button', led: true, display: 3 },
                    10: { type: 'button', led: true, display: 3 },
                    11: { type: 'leverkey', led: true, display: 3 },
                    12: { type: 'leverkey', led: true, display: 3 },
                    13: { type: 'leverkey', led: true, display: 4 },
                    14: { type: 'leverkey', led: true, display: 4 },
                    15: { type: 'button', led: true, display: 4 },
                    16: { type: 'button', led: true, display: 4 }
                },
                displayMapping: {
                    1: { lines: 2, chars: 16, position: 'top-left' },
                    2: { lines: 2, chars: 16, position: 'top-right' },
                    3: { lines: 2, chars: 16, position: 'bottom-left' },
                    4: { lines: 2, chars: 16, position: 'bottom-right' }
                },
                rotaryMapping: {
                    1: { keys: [1, 2, 3, 4], display: 1 },
                    2: { keys: [5, 6, 7, 8], display: 2 },
                    3: { keys: [9, 10, 11, 12], display: 3 },
                    4: { keys: [13, 14, 15, 16], display: 4 }
                },
                colorProfiles: {
                    idle: { color: 'green', brightness: 50 },
                    active: { color: 'red', brightness: 100 },
                    warning: { color: 'amber', brightness: 75 },
                    off: { color: 'off', brightness: 0 }
                }
            },
            'RSP-1232HL': {
                model: 'RSP-1232HL',
                keys: 32,
                rotaries: 4,
                displays: 4,
                leverkeys: 16,
                keyMapping: {
                    1: { type: 'button', led: true, display: 1 },
                    2: { type: 'button', led: true, display: 1 },
                    3: { type: 'button', led: true, display: 1 },
                    4: { type: 'button', led: true, display: 1 },
                    5: { type: 'button', led: true, display: 1 },
                    6: { type: 'button', led: true, display: 1 },
                    7: { type: 'button', led: true, display: 1 },
                    8: { type: 'button', led: true, display: 1 },
                    9: { type: 'leverkey', led: true, display: 2 },
                    10: { type: 'leverkey', led: true, display: 2 },
                    11: { type: 'leverkey', led: true, display: 2 },
                    12: { type: 'leverkey', led: true, display: 2 },
                    13: { type: 'button', led: true, display: 2 },
                    14: { type: 'button', led: true, display: 2 },
                    15: { type: 'button', led: true, display: 2 },
                    16: { type: 'button', led: true, display: 2 },
                    17: { type: 'button', led: true, display: 3 },
                    18: { type: 'button', led: true, display: 3 },
                    19: { type: 'button', led: true, display: 3 },
                    20: { type: 'button', led: true, display: 3 },
                    21: { type: 'leverkey', led: true, display: 3 },
                    22: { type: 'leverkey', led: true, display: 3 },
                    23: { type: 'leverkey', led: true, display: 3 },
                    24: { type: 'leverkey', led: true, display: 3 },
                    25: { type: 'leverkey', led: true, display: 4 },
                    26: { type: 'leverkey', led: true, display: 4 },
                    27: { type: 'leverkey', led: true, display: 4 },
                    28: { type: 'leverkey', led: true, display: 4 },
                    29: { type: 'button', led: true, display: 4 },
                    30: { type: 'button', led: true, display: 4 },
                    31: { type: 'button', led: true, display: 4 },
                    32: { type: 'button', led: true, display: 4 }
                },
                displayMapping: {
                    1: { lines: 2, chars: 16, position: 'top-left' },
                    2: { lines: 2, chars: 16, position: 'top-right' },
                    3: { lines: 2, chars: 16, position: 'bottom-left' },
                    4: { lines: 2, chars: 16, position: 'bottom-right' }
                },
                rotaryMapping: {
                    1: { keys: [1, 2, 3, 4, 5, 6, 7, 8], display: 1 },
                    2: { keys: [9, 10, 11, 12, 13, 14, 15, 16], display: 2 },
                    3: { keys: [17, 18, 19, 20, 21, 22, 23, 24], display: 3 },
                    4: { keys: [25, 26, 27, 28, 29, 30, 31, 32], display: 4 }
                },
                colorProfiles: {
                    idle: { color: 'green', brightness: 50 },
                    active: { color: 'red', brightness: 100 },
                    warning: { color: 'amber', brightness: 75 },
                    off: { color: 'off', brightness: 0 }
                }
            }
        };

        // Get active preset configuration
        const getSmartPanelPreset = () => {
            if (node.smartpanelPreset && SMARTPANEL_PRESETS[node.smartpanelPreset]) {
                return SMARTPANEL_PRESETS[node.smartpanelPreset];
            }
            return null;
        };

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

        const getTAITimestamp = () => {
            const now = Date.now() / 1000;
            const taiSeconds = Math.floor(now) + 37;
            const taiNanoseconds = Math.floor((now % 1) * 1e9);
            return `${taiSeconds}:${String(taiNanoseconds).padStart(9, '0')}`;
        };

        const getRegistrationApiUrl = () => {
            return `${node.registry.registryUrl}/x-nmos/registration/${node.registry.queryApiVersion}`;
        };

        // ============================================================================
        // Artist-specific Functions
        // ============================================================================

        /**
         * Configure a key on the Artist panel
         */
        const configureKey = (keyNumber, config) => {
            const keyConfig = {
                keyNumber: keyNumber,
                label: config.label || `Key ${keyNumber}`,
                type: config.type || 'intercom', // intercom, gpio, special
                destination: config.destination || null,
                color: config.color || 'green',
                mode: config.mode || 'talk', // talk, listen, both
                enabled: config.enabled !== false,
                timestamp: new Date().toISOString()
            };

            panelState.keys.set(keyNumber, keyConfig);
            node.log(`Key ${keyNumber} configured: ${keyConfig.label}`);

            // Publish key configuration via MQTT
            publishArtistEvent('key_config', {
                key: keyNumber,
                config: keyConfig
            });

            return keyConfig;
        };

        /**
         * Handle key press/release
         */
        const handleKeyAction = (keyNumber, action, pressed) => {
            const key = panelState.keys.get(keyNumber);
            if (!key) {
                node.warn(`Key ${keyNumber} not configured`);
                return null;
            }

            const keyAction = {
                keyNumber: keyNumber,
                label: key.label,
                action: action, // press, release, toggle
                pressed: pressed,
                destination: key.destination,
                mode: key.mode,
                timestamp: new Date().toISOString()
            };

            // Add to history
            commandHistory.unshift({
                type: 'key_action',
                data: keyAction
            });
            if (commandHistory.length > MAX_HISTORY) {
                commandHistory.pop();
            }

            // Publish key action
            publishArtistEvent('key_action', keyAction);

            return keyAction;
        };

        /**
         * Create or update audio route in Artist matrix
         */
        const createAudioRoute = (sourceId, destinationId, config) => {
            const route = {
                sourceId: sourceId,
                destinationId: destinationId,
                gain: config.gain || 0.0,
                muted: config.muted || false,
                mode: config.mode || 'both', // talk, listen, both
                active: true,
                timestamp: new Date().toISOString()
            };

            const routeKey = `${sourceId}->${destinationId}`;
            panelState.audioRoutes.set(routeKey, route);
            
            node.log(`Audio route created: ${routeKey}`);

            // Publish route via MQTT
            publishArtistEvent('audio_route', route);

            return route;
        };

        /**
         * Remove audio route
         */
        const removeAudioRoute = (sourceId, destinationId) => {
            const routeKey = `${sourceId}->${destinationId}`;
            const route = panelState.audioRoutes.get(routeKey);
            
            if (route) {
                panelState.audioRoutes.delete(routeKey);
                node.log(`Audio route removed: ${routeKey}`);
                
                publishArtistEvent('audio_route_removed', {
                    sourceId: sourceId,
                    destinationId: destinationId,
                    timestamp: new Date().toISOString()
                });

                return true;
            }

            return false;
        };

        /**
         * Update panel status
         */
        const updatePanelStatus = (status) => {
            Object.assign(panelState.panelStatus, status);
            panelState.panelStatus.lastUpdate = new Date().toISOString();

            publishArtistEvent('panel_status', panelState.panelStatus);
        };

        /**
         * Publish Artist event via MQTT
         */
        const publishArtistEvent = (eventType, data) => {
            if (!mqttClient || !mqttClient.connected) {
                return false;
            }

            const grain = {
                grain_type: 'event',
                source_id: node.matrixSourceId,
                flow_id: node.senderId,
                origin_timestamp: getTAITimestamp(),
                sync_timestamp: getTAITimestamp(),
                creation_timestamp: getTAITimestamp(),
                rate: { numerator: 0, denominator: 1 },
                duration: { numerator: 0, denominator: 1 },
                grain: {
                    type: 'urn:x-nmos:format:data.event',
                    topic: eventType,
                    data: [{
                        path: `artist/${eventType}`,
                        post: data
                    }]
                }
            };

            const topic = `x-nmos/events/1.0/${node.matrixSourceId}/object`;

            mqttClient.publish(topic, JSON.stringify(grain), {
                qos: node.mqttQos,
                retain: false
            }, (err) => {
                if (err) {
                    node.error(`Artist event publish error: ${err.message}`);
                } else {
                    node.log(`► Artist ${eventType} published`);
                }
            });

            return true;
        };

        /**
         * Set LED color and brightness for a SmartPanel key
         * @param {number} keyId - Key number (1-16 or 1-32)
         * @param {string} color - LED color: "red", "green", "amber", "off"
         * @param {number} brightness - Brightness level 0-100
         */
        const setLedColor = (keyId, color, brightness = 100) => {
            if (!mqttClient || !mqttClient.connected) {
                node.warn('Cannot set LED: MQTT not connected');
                return false;
            }

            const validColors = ['red', 'green', 'amber', 'off'];
            if (!validColors.includes(color)) {
                node.warn(`Invalid LED color: ${color}. Must be one of: ${validColors.join(', ')}`);
                return false;
            }

            const preset = getSmartPanelPreset();
            if (preset && (keyId < 1 || keyId > preset.keys)) {
                node.warn(`Invalid key ID ${keyId} for ${preset.model}. Must be 1-${preset.keys}`);
                return false;
            }

            brightness = Math.max(0, Math.min(100, brightness)); // Clamp to 0-100

            const ledData = {
                color: color,
                brightness: brightness,
                timestamp: new Date().toISOString()
            };

            publishArtistEvent('led_control', {
                path: `led/${keyId}/color`,
                keyId: keyId,
                data: ledData
            });

            node.log(`LED ${keyId}: ${color} @ ${brightness}%`);
            return true;
        };

        /**
         * Send text to a SmartPanel OLED display
         * @param {number} displayId - Display number (1-4)
         * @param {string} text - Text to display (or array of 2 lines)
         * @param {object} options - Display options (brightness, scroll, etc.)
         */
        const sendDisplayText = (displayId, text, options = {}) => {
            if (!mqttClient || !mqttClient.connected) {
                node.warn('Cannot send display text: MQTT not connected');
                return false;
            }

            const preset = getSmartPanelPreset();
            if (preset && (displayId < 1 || displayId > preset.displays)) {
                node.warn(`Invalid display ID ${displayId} for ${preset.model}. Must be 1-${preset.displays}`);
                return false;
            }

            // Format text into lines
            let lines;
            if (Array.isArray(text)) {
                lines = text.slice(0, 2); // Max 2 lines per display
            } else {
                // Split text into lines if it contains newline, otherwise put on line 1
                const textLines = text.split('\n');
                lines = textLines.slice(0, 2);
            }

            // Truncate lines to 16 chars
            lines = lines.map(line => line.substring(0, 16));

            const displayData = {
                displayId: displayId,
                text: lines.join('\n'),
                line1: lines[0] || '',
                line2: lines[1] || '',
                brightness: options.brightness !== undefined ? Math.max(0, Math.min(100, options.brightness)) : 100,
                scroll: options.scroll || false,
                timestamp: new Date().toISOString()
            };

            publishArtistEvent('display_text', {
                path: `display/${displayId}/text`,
                displayId: displayId,
                data: displayData
            });

            node.log(`Display ${displayId}: "${lines.join(' / ')}"`);
            return true;
        };

        /**
         * Send text to a specific line of a display
         * @param {number} displayId - Display number (1-4)
         * @param {number} lineNumber - Line number (1-2)
         * @param {string} text - Text to display (max 16 chars)
         * @param {object} options - Display options
         */
        const sendDisplayLine = (displayId, lineNumber, text, options = {}) => {
            if (!mqttClient || !mqttClient.connected) {
                node.warn('Cannot send display line: MQTT not connected');
                return false;
            }

            const preset = getSmartPanelPreset();
            if (preset && (displayId < 1 || displayId > preset.displays)) {
                node.warn(`Invalid display ID ${displayId} for ${preset.model}. Must be 1-${preset.displays}`);
                return false;
            }

            if (lineNumber < 1 || lineNumber > 2) {
                node.warn(`Invalid line number ${lineNumber}. Must be 1 or 2`);
                return false;
            }

            const truncatedText = text.substring(0, 16);

            const lineData = {
                displayId: displayId,
                lineNumber: lineNumber,
                text: truncatedText,
                brightness: options.brightness !== undefined ? Math.max(0, Math.min(100, options.brightness)) : 100,
                timestamp: new Date().toISOString()
            };

            publishArtistEvent('display_line', {
                path: `display/${displayId}/line/${lineNumber}`,
                displayId: displayId,
                lineNumber: lineNumber,
                data: lineData
            });

            node.log(`Display ${displayId} Line ${lineNumber}: "${truncatedText}"`);
            return true;
        };

        /**
         * Apply a color profile to a key
         * @param {number} keyId - Key number
         * @param {string} profile - Profile name: "idle", "active", "warning", "off"
         */
        const applyColorProfile = (keyId, profile) => {
            const preset = getSmartPanelPreset();
            if (!preset) {
                node.warn('No SmartPanel preset configured');
                return false;
            }

            if (!preset.colorProfiles[profile]) {
                node.warn(`Unknown color profile: ${profile}`);
                return false;
            }

            const colorProfile = preset.colorProfiles[profile];
            return setLedColor(keyId, colorProfile.color, colorProfile.brightness);
        };

        /**
         * Parse incoming Artist commands (enhanced for SmartPanel)
         */
        const parseArtistCommand = (grain) => {
            if (!grain.grain || !grain.grain.data) {
                return null;
            }

            const commands = [];

            for (const item of grain.grain.data) {
                const path = item.path || '';
                const value = item.post;

                let command = {
                    raw_path: path,
                    raw_value: value,
                    pre_value: item.pre,
                    timestamp: new Date().toISOString()
                };

                // Parse Artist-specific paths
                // Key control: artist/key/N/press, artist/key/N/release
                if (path.match(/^artist\/key\/(\d+)\/(press|release|toggle)$/i)) {
                    const match = path.match(/^artist\/key\/(\d+)\/(press|release|toggle)$/i);
                    command.type = 'key_action';
                    command.key = parseInt(match[1]);
                    command.action = match[2].toLowerCase();
                    command.pressed = (command.action === 'press' || command.action === 'toggle' && value);
                }
                // Button press/release: button/N/press, button/N/release
                else if (path.match(/^button\/(\d+)\/(press|release)$/i)) {
                    const match = path.match(/^button\/(\d+)\/(press|release)$/i);
                    command.type = 'button';
                    command.button = parseInt(match[1]);
                    command.action = match[2].toLowerCase();
                    command.pressed = (command.action === 'press');
                }
                // LeverKey up/down: leverkey/N/up, leverkey/N/down
                else if (path.match(/^leverkey\/(\d+)\/(up|down)$/i)) {
                    const match = path.match(/^leverkey\/(\d+)\/(up|down)$/i);
                    command.type = 'leverkey';
                    command.leverkey = parseInt(match[1]);
                    command.direction = match[2].toLowerCase();
                    command.state = !!value;
                }
                // Rotary encoder: rotary/N/left, rotary/N/right, rotary/N/push
                else if (path.match(/^rotary\/(\d+)\/(left|right|push)$/i)) {
                    const match = path.match(/^rotary\/(\d+)\/(left|right|push)$/i);
                    command.type = 'rotary';
                    command.rotary = parseInt(match[1]);
                    command.action = match[2].toLowerCase();
                    command.value = value;
                }
                // Audio route: artist/route/source_id/destination_id
                else if (path.match(/^artist\/route\/([^\/]+)\/([^\/]+)$/i)) {
                    const match = path.match(/^artist\/route\/([^\/]+)\/([^\/]+)$/i);
                    command.type = 'audio_route';
                    command.sourceId = match[1];
                    command.destinationId = match[2];
                    command.active = !!value;
                }
                // Panel registration: artist/panel/register
                else if (path.match(/^artist\/panel\/register$/i)) {
                    command.type = 'panel_register';
                    command.panelInfo = value;
                }
                // Matrix config: artist/matrix/config
                else if (path.match(/^artist\/matrix\/(config|inputs|outputs)$/i)) {
                    const match = path.match(/^artist\/matrix\/(\w+)$/i);
                    command.type = 'matrix_config';
                    command.configType = match[1];
                    command.data = value;
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
    return {
        id: node.nodeId,
        version: getTAITimestamp(),
        label: `${node.deviceLabel} Node`,
        description: node.deviceDescription,
        href: `http://${localIP}:${node.registry.httpPort || 1880}/`,
        hostname: os.hostname(),
        caps: {},
        services: [],  // ← ADD THIS LINE - REQUIRED FOR IS-04 v1.3
        tags: {
            'urn:x-nmos:tag:riedel/artist': ['panel'],
            'urn:x-nmos:tag:is07/role': ['sender', 'receiver']
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
};

        const buildDeviceResource = () => {
            return {
                id: node.deviceId,
                version: getTAITimestamp(),
                label: node.deviceLabel,
                description: node.deviceDescription,
                type: 'urn:x-nmos:device:generic',
                node_id: node.nodeId,
                senders: [node.senderId],
                receivers: [node.receiverId],
                tags: {
                    'urn:x-nmos:tag:riedel/artist': ['panel', node.panelType],
                    'urn:x-nmos:tag:is07/endpoint': ['true'],
                    'urn:x-nmos:tag:application': ['intercom']
                }
            };
        };

        const buildSenderResource = () => {
            return {
                id: node.senderId,
                version: getTAITimestamp(),
                label: `${node.panelLabel} Sender`,
                description: `Artist panel events - ${node.panelLabel}`,
                format: 'urn:x-nmos:format:data',
                caps: {
                    media_types: ['application/json']
                },
                tags: {
                    'urn:x-nmos:tag:is07/event_types': ['object'],
                    'urn:x-nmos:tag:is07/transport': ['mqtt'],
                    'urn:x-nmos:tag:riedel/artist': ['events']
                },
                device_id: node.deviceId,
                transport: 'urn:x-nmos:transport:mqtt',
                interface_bindings: [ifaceName],
                manifest_href: null,
                flow_id: null,
                subscription: {
                    receiver_id: null,
                    active: false
                }
            };
        };

        const buildReceiverResource = () => {
            return {
                id: node.receiverId,
                version: getTAITimestamp(),
                label: `${node.panelLabel} Receiver`,
                description: `Artist panel commands - ${node.panelLabel}`,
                format: 'urn:x-nmos:format:data',
                caps: {
                    media_types: ['application/json']
                },
                tags: {
                    'urn:x-nmos:tag:is07/event_types': ['object'],
                    'urn:x-nmos:tag:is07/transport': ['mqtt'],
                    'urn:x-nmos:tag:riedel/artist': ['commands']
                },
                device_id: node.deviceId,
                transport: 'urn:x-nmos:transport:mqtt',
                interface_bindings: [ifaceName],
                subscription: {
                    sender_id: null,
                    active: false
                }
            };
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
                node.log('Starting RIEDEL Artist Registration');
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

                // Register Sender
                const ok3 = await registerResource('sender', buildSenderResource());
                if (!ok3) throw new Error('Sender registration failed');
                await new Promise(r => setTimeout(r, 300));

                // Register Receiver
                const ok4 = await registerResource('receiver', buildReceiverResource());
                if (!ok4) throw new Error('Receiver registration failed');

                registrationComplete = true;
                panelState.panelStatus.registered = true;
                updatePanelStatus({ registered: true });
                node.status({ fill: 'green', shape: 'dot', text: 'registered' });
                node.log('✓ RIEDEL ARTIST PANEL REGISTERED');
                node.log('═══════════════════════════════════════');
                return true;

            } catch (err) {
                registrationComplete = false;
                panelState.panelStatus.registered = false;
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
        // MQTT Functions
        // ============================================================================

        function setupMQTTClient() {
            const subscribeTopic = `x-nmos/events/1.0/+/+`;

            node.log(`Connecting MQTT: ${node.mqttBroker}`);
            node.log(`Subscribe pattern: ${subscribeTopic}`);

            mqttClient = mqtt.connect(node.mqttBroker, {
                clientId: `nmos-riedel-artist-${node.deviceId}`,
                clean: true,
                reconnectPeriod: 5000
            });

            mqttClient.on('connect', () => {
                node.log('✓ MQTT connected');
                panelState.panelStatus.connected = true;
                updatePanelStatus({ connected: true });
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
                    
                    // Don't process our own messages
                    if (grain.source_id === node.matrixSourceId) {
                        return;
                    }

                    node.log(`◄ Artist command from ${grain.source_id}`);

                    // Parse Artist commands
                    const artistCommands = parseArtistCommand(grain);

                    // Add to command history
                    if (artistCommands && artistCommands.length > 0) {
                        commandHistory.unshift({
                            timestamp: new Date().toISOString(),
                            source_id: grain.source_id,
                            topic: topic,
                            grain_type: grain.grain_type,
                            commands: artistCommands
                        });
                        if (commandHistory.length > MAX_HISTORY) {
                            commandHistory.pop();
                        }
                    }

                    // Output message
                    const outputMsg = {
                        topic: topic,
                        payload: grain,
                        source_id: grain.source_id,
                        flow_id: grain.flow_id,
                        artist: {
                            device_id: node.deviceId,
                            panel_label: node.panelLabel,
                            panel_type: node.panelType
                        }
                    };

                    // Add parsed Artist commands if available
                    if (artistCommands && artistCommands.length > 0) {
                        outputMsg.artist.commands = artistCommands;
                    }

                    node.send(outputMsg);

                } catch (e) {
                    node.warn(`Invalid grain message: ${e.message}`);
                }
            });

            mqttClient.on('error', (err) => {
                node.error(`MQTT error: ${err.message}`);
                panelState.panelStatus.connected = false;
                node.status({ fill: 'red', shape: 'ring', text: 'mqtt error' });
            });

            mqttClient.on('offline', () => {
                node.warn('MQTT offline');
                panelState.panelStatus.connected = false;
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
                            senderId: node.senderId,
                            receiverId: node.receiverId,
                            matrixSourceId: node.matrixSourceId,
                            panelLabel: node.panelLabel,
                            panelType: node.panelType,
                            panelStatus: panelState.panelStatus,
                            registered: registrationComplete,
                            mqttConnected: mqttClient && mqttClient.connected,
                            mqttBroker: node.mqttBroker,
                            keysConfigured: panelState.keys.size,
                            activeRoutes: panelState.audioRoutes.size,
                            enableAudioRouting: node.enableAudioRouting,
                            enableKeyControl: node.enableKeyControl
                        };
                        node.send(msg);
                        break;

                    case 'configure_key':
                        const keyNum = msg.payload.key || msg.key;
                        const keyConf = msg.payload.config || msg.config || {};
                        if (!keyNum) {
                            throw new Error('configure_key requires key number');
                        }
                        const key = configureKey(keyNum, keyConf);
                        msg.payload = { success: true, action: 'configure_key', key: key };
                        node.send(msg);
                        break;

                    case 'key_action':
                        const actionKeyNum = msg.payload.key || msg.key;
                        const actionType = msg.payload.actionType || msg.actionType || 'press';
                        const pressed = msg.payload.pressed !== undefined ? msg.payload.pressed : true;
                        if (!actionKeyNum) {
                            throw new Error('key_action requires key number');
                        }
                        const keyAction = handleKeyAction(actionKeyNum, actionType, pressed);
                        msg.payload = { success: true, action: 'key_action', keyAction: keyAction };
                        node.send(msg);
                        break;

                    case 'create_route':
                        if (!node.enableAudioRouting) {
                            throw new Error('Audio routing is disabled');
                        }
                        const srcId = msg.payload.sourceId || msg.sourceId;
                        const dstId = msg.payload.destinationId || msg.destinationId;
                        const routeConf = msg.payload.config || msg.config || {};
                        if (!srcId || !dstId) {
                            throw new Error('create_route requires sourceId and destinationId');
                        }
                        const route = createAudioRoute(srcId, dstId, routeConf);
                        msg.payload = { success: true, action: 'create_route', route: route };
                        node.send(msg);
                        break;

                    case 'remove_route':
                        if (!node.enableAudioRouting) {
                            throw new Error('Audio routing is disabled');
                        }
                        const rmSrcId = msg.payload.sourceId || msg.sourceId;
                        const rmDstId = msg.payload.destinationId || msg.destinationId;
                        if (!rmSrcId || !rmDstId) {
                            throw new Error('remove_route requires sourceId and destinationId');
                        }
                        const removed = removeAudioRoute(rmSrcId, rmDstId);
                        msg.payload = { success: removed, action: 'remove_route' };
                        node.send(msg);
                        break;

                    case 'get_keys':
                        const keys = Array.from(panelState.keys.values());
                        msg.payload = {
                            keys: keys,
                            count: keys.length
                        };
                        node.send(msg);
                        break;

                    case 'get_routes':
                        const routes = Array.from(panelState.audioRoutes.values());
                        msg.payload = {
                            routes: routes,
                            count: routes.length
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

                    case 'update_panel_status':
                        const statusUpdate = msg.payload.status || msg.status || {};
                        updatePanelStatus(statusUpdate);
                        msg.payload = { success: true, action: 'update_panel_status', status: panelState.panelStatus };
                        node.send(msg);
                        break;

                    case 'clear_history':
                        commandHistory.length = 0;
                        msg.payload = { success: true, action: 'clear_history' };
                        node.send(msg);
                        break;

                    case 'clear_keys':
                        panelState.keys.clear();
                        msg.payload = { success: true, action: 'clear_keys' };
                        node.send(msg);
                        break;

                    case 'clear_routes':
                        panelState.audioRoutes.clear();
                        msg.payload = { success: true, action: 'clear_routes' };
                        node.send(msg);
                        break;

                    case 're-register':
                        node.log('Manual re-registration requested');
                        await registerAll();
                        break;

                    case 'set_led_color':
                        const ledKeyId = msg.payload.keyId || msg.payload.key || msg.keyId;
                        const ledColor = msg.payload.color || msg.color;
                        const ledBrightness = msg.payload.brightness !== undefined ? msg.payload.brightness : 100;
                        if (!ledKeyId || !ledColor) {
                            throw new Error('set_led_color requires keyId and color');
                        }
                        const ledOk = setLedColor(ledKeyId, ledColor, ledBrightness);
                        msg.payload = { success: ledOk, action: 'set_led_color', keyId: ledKeyId, color: ledColor, brightness: ledBrightness };
                        node.send(msg);
                        break;

                    case 'send_display_text':
                        const dispId = msg.payload.displayId || msg.payload.display || msg.displayId;
                        const dispText = msg.payload.text || msg.text;
                        const dispOptions = {
                            brightness: msg.payload.brightness,
                            scroll: msg.payload.scroll
                        };
                        if (!dispId || dispText === undefined || dispText === null || dispText === '') {
                            throw new Error('send_display_text requires displayId and non-empty text');
                        }
                        const dispOk = sendDisplayText(dispId, dispText, dispOptions);
                        msg.payload = { success: dispOk, action: 'send_display_text', displayId: dispId, text: dispText };
                        node.send(msg);
                        break;

                    case 'send_display_line':
                        const lineDispId = msg.payload.displayId || msg.payload.display || msg.displayId;
                        const lineNumber = msg.payload.lineNumber !== undefined ? msg.payload.lineNumber : (msg.payload.line !== undefined ? msg.payload.line : msg.lineNumber);
                        const lineText = msg.payload.text !== undefined ? msg.payload.text : msg.text;
                        const lineOptions = {
                            brightness: msg.payload.brightness
                        };
                        if (!lineDispId || lineNumber === undefined || lineNumber === null || lineText === undefined || lineText === null || lineText === '') {
                            throw new Error('send_display_line requires displayId, lineNumber, and non-empty text');
                        }
                        const lineOk = sendDisplayLine(lineDispId, lineNumber, lineText, lineOptions);
                        msg.payload = { success: lineOk, action: 'send_display_line', displayId: lineDispId, lineNumber: lineNumber, text: lineText };
                        node.send(msg);
                        break;

                    case 'apply_color_profile':
                        const profileKeyId = msg.payload.keyId || msg.payload.key || msg.keyId;
                        const profileName = msg.payload.profile || msg.profile;
                        if (!profileKeyId || !profileName) {
                            throw new Error('apply_color_profile requires keyId and profile');
                        }
                        const profileOk = applyColorProfile(profileKeyId, profileName);
                        msg.payload = { success: profileOk, action: 'apply_color_profile', keyId: profileKeyId, profile: profileName };
                        node.send(msg);
                        break;

                    case 'get_smartpanel_preset':
                        const preset = getSmartPanelPreset();
                        msg.payload = {
                            preset: node.smartpanelPreset,
                            config: preset
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
            node.log('Shutting down RIEDEL Artist panel...');
            
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
                    await axios.delete(`${registrationApiUrl}/resource/senders/${node.senderId}`, { headers }).catch(() => {});
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

    RED.nodes.registerType('nmos-riedel-artist', NMOSRiedelArtistNode);
};
