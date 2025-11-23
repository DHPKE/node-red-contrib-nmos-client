const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

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
                interface_bindings: [localIP],
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
        
        const registerResource = async (type, data) => {
            try {
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = {
                    ...node.registry.getAuthHeaders(),
                    'Content-Type': 'application/json'
                };
                
                const payload = { type, data };
                
                node.log(`Registering ${type}...`);
                
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
        
        const registerWithRegistry = async () => {
            try {
                node.status({fill: "blue", shape: "dot", text: "registering..."});
                node.log(`═══════════════════════════════════════`);
                node.log(`Registering with: ${getRegistrationApiUrl()}`);
                node.log(`Local IP: ${localIP}`);
                node.log(`Local MAC: ${localMAC}`);
                node.log(`Interface: ${ifaceName}`);
                node.log(`═══════════════════════════════════════`);
                
                const nodeSuccess = await registerResource('node', buildNodeResource());
                if (!nodeSuccess) {
                    throw new Error('Node registration failed');
                }
                
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const deviceSuccess = await registerResource('device', buildDeviceResource());
                if (!deviceSuccess) {
                    throw new Error('Device registration failed');
                }
                
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const receiverSuccess = await registerResource('receiver', buildReceiverResource());
                if (!receiverSuccess) {
                    throw new Error('Receiver registration failed');
                }
                
                registrationComplete = true;
                node.status({fill: "green", shape: "dot", text: "registered"});
                node.log('═══════════════════════════════════════');
                node.log('✓ ALL RESOURCES REGISTERED SUCCESSFULLY');
                node.log('═══════════════════════════════════════');
                
                return true;
                
            } catch (error) {
                node.error(`Registration failed: ${error.message}`);
                node.status({fill: "red", shape: "ring", text: "registration failed"});
                registrationComplete = false;
                return false;
            }
        };
        
        const sendHeartbeat = async () => {
            try {
                if (!registrationComplete) {
                    return;
                }
                
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
                    node.log('♥ Heartbeat OK');
                } else if (response.status === 404) {
                    node.warn('Heartbeat returned 404 - re-registering');
                    registrationComplete = false;
                    await registerWithRegistry();
                } else {
                    node.warn(`Heartbeat returned status: ${response.status}`);
                }
                
            } catch (error) {
                node.warn(`Heartbeat failed: ${error.message}`);
                registrationComplete = false;
                setTimeout(() => registerWithRegistry(), 1000);
            }
        };
        
        const updateReceiverInRegistry = async () => {
            try {
                if (!registrationComplete) {
                    return;
                }
                
                const receiverResource = buildReceiverResource();
                await registerResource('receiver', receiverResource);
                node.log('Updated receiver subscription in registry');
                
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
                
                node.log('✓ Unregistered from NMOS registry');
                
            } catch (error) {
                node.warn(`Unregistration error: ${error.message}`);
            }
        };
        
        const setupNodeAPI = () => {
            const app = RED.httpNode || RED.httpAdmin;
            const version = node.registry.queryApiVersion;
            const basePath = `/x-nmos/node/${version}`;
            
            node.log(`Setting up IS-04 Node API at: ${basePath}`);
            
            const middleware = (req, res, next) => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                
                if (req.method === 'OPTIONS') {
                    res.sendStatus(200);
                    return;
                }
                next();
            };
            
            // GET /x-nmos/node/{version}/ - Return available endpoints
            app.get(`${basePath}/`, middleware, (req, res) => {
                node.log('GET /x-nmos/node/{version}/');
                res.json(['self/', 'devices/', 'sources/', 'flows/', 'senders/', 'receivers/']);
            });
            
            // GET /x-nmos/node/{version}/self/ - Return node resource
            app.get(`${basePath}/self/`, middleware, (req, res) => {
                node.log('GET /x-nmos/node/{version}/self/');
                const nodeResource = buildNodeResource();
                res.json(nodeResource);
            });
            
            // GET /x-nmos/node/{version}/devices/ - Return devices array
            app.get(`${basePath}/devices/`, middleware, (req, res) => {
                node.log('GET /x-nmos/node/{version}/devices/');
                const deviceResource = buildDeviceResource();
                res.json([deviceResource]);
            });
            
            // GET /x-nmos/node/{version}/devices/{deviceId} - Return specific device
            app.get(`${basePath}/devices/:deviceId`, middleware, (req, res) => {
                node.log(`GET /x-nmos/node/{version}/devices/${req.params.deviceId}`);
                if (req.params.deviceId === node.deviceId) {
                    const deviceResource = buildDeviceResource();
                    res.json(deviceResource);
                } else {
                    res.status(404).json({
                        code: 404,
                        error: 'Device not found',
                        debug: `Device ${req.params.deviceId} does not exist`
                    });
                }
            });
            
            // GET /x-nmos/node/{version}/sources/ - Return empty array (no sources)
            app.get(`${basePath}/sources/`, middleware, (req, res) => {
                node.log('GET /x-nmos/node/{version}/sources/');
                res.json([]);
            });
            
            // GET /x-nmos/node/{version}/flows/ - Return empty array (no flows)
            app.get(`${basePath}/flows/`, middleware, (req, res) => {
                node.log('GET /x-nmos/node/{version}/flows/');
                res.json([]);
            });
            
            // GET /x-nmos/node/{version}/senders/ - Return empty array (no senders)
            app.get(`${basePath}/senders/`, middleware, (req, res) => {
                node.log('GET /x-nmos/node/{version}/senders/');
                res.json([]);
            });
            
            // GET /x-nmos/node/{version}/receivers/ - Return receivers array
            app.get(`${basePath}/receivers/`, middleware, (req, res) => {
                node.log('GET /x-nmos/node/{version}/receivers/');
                const receiverResource = buildReceiverResource();
                res.json([receiverResource]);
            });
            
            // GET /x-nmos/node/{version}/receivers/{receiverId} - Return specific receiver
            app.get(`${basePath}/receivers/:receiverId`, middleware, (req, res) => {
                node.log(`GET /x-nmos/node/{version}/receivers/${req.params.receiverId}`);
                if (req.params.receiverId === node.receiverId) {
                    const receiverResource = buildReceiverResource();
                    res.json(receiverResource);
                } else {
                    res.status(404).json({
                        code: 404,
                        error: 'Receiver not found',
                        debug: `Receiver ${req.params.receiverId} does not exist`
                    });
                }
            });
            
            node.log(`✓ IS-04 Node API ready: http://${localIP}:${node.httpPort}${basePath}/`);
        };
        
        const setupConnectionAPI = () => {
            const app = RED.httpNode || RED.httpAdmin;
            const version = node.registry.connectionApiVersion;
            const apiRoot = `/x-nmos/connection/${version}`;
            const basePath = `${apiRoot}/single/receivers/${node.receiverId}`;
            
            node.log(`Setting up IS-05 endpoints at: ${basePath}`);
            
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
        
        const setupTestingFacade = () => {
            const app = RED.httpNode || RED.httpAdmin;
            const basePath = '/x-nmos/testquestion/v1.0';
            
            node.log(`Setting up Testing Facade at: ${basePath}`);
            
            const middleware = (req, res, next) => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                
                if (req.method === 'OPTIONS') {
                    res.sendStatus(200);
                    return;
                }
                next();
            };
            
            // POST /x-nmos/testquestion/v1.0/ - Handle test questions
            app.post(`${basePath}/`, middleware, (req, res) => {
                try {
                    const bodyStr = req.body ? JSON.stringify(req.body).substring(0, 200) : 'empty';
                    node.log(`POST /x-nmos/testquestion/v1.0/ - ${bodyStr}`);
                } catch (err) {
                    node.log('POST /x-nmos/testquestion/v1.0/ - [body serialization failed]');
                }
                
                // Basic response for testing facade
                // The actual implementation would depend on specific test requirements
                res.json({
                    status: 'ok',
                    message: 'Test question received',
                    timestamp: getTAITimestamp()
                });
            });
            
            node.log(`✓ Testing Facade ready: http://${localIP}:${node.httpPort}${basePath}/`);
        };
        
        setupConnectionAPI();
        setupNodeAPI();
        setupTestingFacade();
        
        registerWithRegistry().then(success => {
            if (success) {
                node.log('Starting heartbeat (5s interval)');
                heartbeatInterval = setInterval(() => sendHeartbeat(), 5000);
                setTimeout(() => sendHeartbeat(), 1000);
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
            
            unregisterFromRegistry().then(() => {
                node.status({});
                done();
            }).catch(() => done());
        });
    }
    
    RED.nodes.registerType("nmos-node", NMOSNodeNode);
};