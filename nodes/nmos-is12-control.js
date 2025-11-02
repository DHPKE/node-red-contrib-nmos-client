const WebSocket = require('ws');
const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

module.exports = function(RED) {
    function NMOSIS12ControlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.wsPort = config.wsPort || 3001;
        this.deviceLabel = config.deviceLabel || 'Node-RED IS-12 Device';
        this.deviceDescription = config.deviceDescription || 'IS-12 Control Device';
        this.deviceId = config.deviceId || uuidv4();
        this.nodeId = config.nodeId || uuidv4();
        this.controlType = config.controlType || 'generic';
        
        let wss = null;
        let wsConnections = new Set();
        let registrationComplete = false;
        let heartbeatInterval = null;
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        if (!this.wsPort) {
            node.error("No WebSocket port configured");
            node.status({fill: "red", shape: "ring", text: "no ws port"});
            return;
        }
        
        let controlModel = {
            root: {
                classId: [1, 1],
                oid: 1,
                role: 'root',
                description: 'Root block',
                members: [2, 3, 4]
            },
            workers: {
                gain: {
                    classId: [1, 2, 1],
                    oid: 2,
                    role: 'gain',
                    description: 'Gain control',
                    value: 0.0,
                    minValue: -60.0,
                    maxValue: 12.0
                },
                mute: {
                    classId: [1, 2, 2],
                    oid: 3,
                    role: 'mute',
                    description: 'Mute control',
                    value: false
                },
                level: {
                    classId: [1, 2, 3],
                    oid: 4,
                    role: 'level',
                    description: 'Level meter',
                    value: -20.0,
                    readOnly: true
                }
            }
        };
        
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
        

        
        const getTAITimestamp = () => {
            const now = Date.now() / 1000;
            const taiSeconds = Math.floor(now) + 37;
            const taiNanoseconds = Math.floor((now % 1) * 1000000000);
            return `${taiSeconds}:${String(taiNanoseconds).padStart(9, '0')}`;
        };
        
        const getRegistrationApiUrl = () => {
            return `${node.registry.registryUrl}/x-nmos/registration/${node.registry.queryApiVersion}`;
        };
        
        const buildNodeResource = () => {
            return {
                id: node.nodeId,
                version: getTAITimestamp(),
                label: `${node.deviceLabel} Node`,
                description: 'IS-12 Control Node',
                tags: {},
                href: `http://${localIP}:1880/`,
                hostname: os.hostname(),
                api: {
                    versions: [node.registry.queryApiVersion],
                    endpoints: [{
                        host: localIP,
                        port: 1880,
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
                    chassis_id: localMAC,
                    port_id: localMAC,
                    name: ifaceName
                }]
            };
        };
        
        const buildDeviceResource = () => {
            return {
                id: node.deviceId,
                version: getTAITimestamp(),
                label: node.deviceLabel,
                description: node.deviceDescription,
                tags: {},
                type: `urn:x-nmos:device:${node.controlType}`,
                node_id: node.nodeId,
                senders: [],
                receivers: [],
                controls: [{
                    type: 'urn:x-nmos:control:ncp/v1.0',
                    href: `ws://${localIP}:${node.wsPort}/x-nmos/ncp/v1.0`
                }]
            };
        };
        
        const registerWithRegistry = async () => {
            try {
                node.status({fill: "blue", shape: "dot", text: "registering..."});
                
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = {
                    ...node.registry.getAuthHeaders(),
                    'Content-Type': 'application/json'
                };
                
                node.log('Registering IS-12 Device');
                
                const nodePayload = { type: 'node', data: buildNodeResource() };
                const nodeResp = await axios.post(
                    `${registrationApiUrl}/resource`,
                    nodePayload,
                    { headers, timeout: 10000, validateStatus: s => s < 500 }
                );
                
                if (nodeResp.status !== 200 && nodeResp.status !== 201) {
                    throw new Error(`Node registration failed: ${nodeResp.status}`);
                }
                node.log('✓ Node registered');
                
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const devicePayload = { type: 'device', data: buildDeviceResource() };
                const deviceResp = await axios.post(
                    `${registrationApiUrl}/resource`,
                    devicePayload,
                    { headers, timeout: 10000, validateStatus: s => s < 500 }
                );
                
                if (deviceResp.status !== 200 && deviceResp.status !== 201) {
                    throw new Error(`Device registration failed: ${deviceResp.status}`);
                }
                node.log('✓ Device registered with IS-12 control');
                
                registrationComplete = true;
                node.status({fill: "green", shape: "dot", text: "registered"});
                
                return true;
            } catch (error) {
                node.error(`Registration failed: ${error.message}`);
                node.status({fill: "red", shape: "ring", text: "registration failed"});
                return false;
            }
        };
        
        const sendHeartbeat = async () => {
            try {
                if (!registrationComplete) return;
                
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = node.registry.getAuthHeaders();
                
                const response = await axios.post(
                    `${registrationApiUrl}/health/nodes/${node.nodeId}`,
                    {},
                    { headers, timeout: 5000, validateStatus: s => s < 500 }
                );
                
                if (response.status === 200) {
                    node.log('♥ Heartbeat OK');
                } else if (response.status === 404) {
                    node.warn('Heartbeat 404 - re-registering');
                    registrationComplete = false;
                    await registerWithRegistry();
                }
            } catch (error) {
                node.warn(`Heartbeat failed: ${error.message}`);
            }
        };
        
        const setupWebSocketServer = () => {
            node.log(`Starting WebSocket server on port ${node.wsPort}`);
            
            try {
                wss = new WebSocket.Server({ 
                    port: node.wsPort,
                    path: '/x-nmos/ncp/v1.0'
                });
                
                wss.on('listening', () => {
                    node.log(`✓ WebSocket server listening on port ${node.wsPort}`);
                    if (registrationComplete) {
                        node.status({fill: "green", shape: "dot", text: "WebSocket ready"});
                    }
                });
                
                wss.on('connection', (ws) => {
                    wsConnections.add(ws);
                    node.log('✓ WebSocket client connected');
                    
                    ws.on('message', (data) => {
                        try {
                            const command = JSON.parse(data.toString());
                            node.log(`◄ Command received`);
                            const response = handleIS12Command(command);
                            ws.send(JSON.stringify(response));
                        } catch (error) {
                            node.error(`WebSocket message error: ${error.message}`);
                        }
                    });
                    
                    ws.on('close', () => {
                        wsConnections.delete(ws);
                        node.log('WebSocket client disconnected');
                    });
                    
                    ws.on('error', (error) => {
                        node.error(`WebSocket error: ${error.message}`);
                    });
                });
                
                wss.on('error', (error) => {
                    node.error(`WebSocket server error: ${error.message}`);
                    node.status({fill: "red", shape: "ring", text: "WebSocket error"});
                });
            } catch (error) {
                node.error(`WebSocket setup failed: ${error.message}`);
                node.status({fill: "red", shape: "ring", text: "setup failed"});
            }
        };
        
        const handleIS12Command = (command) => {
            const response = {
                messageType: 1,
                responses: []
            };
            
            if (command.commands && Array.isArray(command.commands)) {
                for (const cmd of command.commands) {
                    try {
                        const result = processCommand(cmd);
                        response.responses.push({
                            handle: cmd.handle,
                            result: result
                        });
                    } catch (error) {
                        response.responses.push({
                            handle: cmd.handle,
                            result: {
                                status: 8,
                                errorMessage: error.message
                            }
                        });
                    }
                }
            }
            
            node.log(`► Response prepared`);
            return response;
        };
        
        const processCommand = (cmd) => {
            const { oid, methodId, arguments: args } = cmd;
            
            let worker = null;
            for (const key in controlModel.workers) {
                if (controlModel.workers[key].oid === oid) {
                    worker = controlModel.workers[key];
                    break;
                }
            }
            
            if (!worker && oid !== 1) {
                throw new Error(`Object ${oid} not found`);
            }
            
            if (oid === 1) {
                return {
                    status: 0,
                    value: controlModel.root
                };
            }
            
            if (methodId.level === 3 && methodId.index === 1) {
                return {
                    status: 0,
                    value: worker.value
                };
            } else if (methodId.level === 3 && methodId.index === 2) {
                if (worker.readOnly) {
                    throw new Error('Property is read-only');
                }
                
                const newValue = args.value;
                
                if (typeof newValue === 'number' && worker.minValue !== undefined) {
                    if (newValue < worker.minValue || newValue > worker.maxValue) {
                        throw new Error(`Value out of range`);
                    }
                }
                
                worker.value = newValue;
                node.log(`✓ Set ${worker.role} = ${newValue}`);
                
                node.send({
                    payload: {
                        event: 'property_changed',
                        oid: oid,
                        role: worker.role,
                        value: newValue
                    },
                    topic: 'is12/control'
                });
                
                sendNotification(oid, worker.role, newValue);
                
                return {
                    status: 0,
                    value: newValue
                };
            }
            
            throw new Error(`Method not supported`);
        };
        
        const sendNotification = (oid, propertyName, value) => {
            if (wsConnections.size === 0) return;
            
            const notification = {
                messageType: 2,
                notifications: [{
                    oid: oid,
                    eventId: { level: 1, index: 1 },
                    eventData: {
                        propertyId: { level: 2, index: 1 },
                        changeType: 0,
                        value: value
                    }
                }]
            };
            
            const notificationStr = JSON.stringify(notification);
            wsConnections.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(notificationStr);
                }
            });
            node.log(`► Notification sent: ${propertyName}=${value}`);
        };
        
        const unregisterFromRegistry = async () => {
            try {
                if (!registrationComplete) return;
                
                const registrationApiUrl = getRegistrationApiUrl();
                const headers = node.registry.getAuthHeaders();
                
                await axios.delete(
                    `${registrationApiUrl}/resource/devices/${node.deviceId}`,
                    { headers, timeout: 5000 }
                ).catch(() => {});
                
                await axios.delete(
                    `${registrationApiUrl}/resource/nodes/${node.nodeId}`,
                    { headers, timeout: 5000 }
                ).catch(() => {});
                
                node.log('✓ Unregistered');
            } catch (error) {
                node.warn(`Unregister error: ${error.message}`);
            }
        };
        
        setupWebSocketServer();
        
        registerWithRegistry().then(success => {
            if (success) {
                node.status({fill: "green", shape: "dot", text: "WebSocket ready"});
                heartbeatInterval = setInterval(() => sendHeartbeat(), 5000);
                setTimeout(() => sendHeartbeat(), 1000);
            }
        });
        
        node.on('input', function(msg) {
            if (!msg.payload || !msg.payload.action) return;
            
            switch (msg.payload.action) {
                case 'get_state':
                    msg.payload = {
                        deviceId: node.deviceId,
                        nodeId: node.nodeId,
                        registered: registrationComplete,
                        wsConnected: wsConnections.size > 0,
                        wsPort: node.wsPort,
                        wsEndpoint: `ws://${localIP}:${node.wsPort}/x-nmos/ncp/v1.0`,
                        activeConnections: wsConnections.size,
                        controlModel: controlModel
                    };
                    node.send(msg);
                    break;
                    
                case 'set_property':
                    const { role, value } = msg.payload;
                    for (const key in controlModel.workers) {
                        if (controlModel.workers[key].role === role) {
                            if (controlModel.workers[key].readOnly) {
                                node.warn(`${role} is read-only`);
                                break;
                            }
                            
                            controlModel.workers[key].value = value;
                            node.log(`✓ Set ${role} = ${value}`);
                            sendNotification(controlModel.workers[key].oid, role, value);
                            
                            msg.payload = {
                                success: true,
                                role: role,
                                value: value
                            };
                            node.send(msg);
                            break;
                        }
                    }
                    break;
                    
                case 're-register':
                    registerWithRegistry();
                    break;
            }
        });
        
        node.on('close', function(done) {
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            
            // Close all WebSocket connections
            wsConnections.forEach(ws => {
                try {
                    ws.close();
                } catch (e) {
                    // Ignore close errors
                }
            });
            wsConnections.clear();
            
            // Close WebSocket server
            if (wss) {
                wss.close(() => {
                    node.log('✓ WebSocket server closed');
                    unregisterFromRegistry().then(() => {
                        node.status({});
                        done();
                    }).catch(() => done());
                });
            } else {
                unregisterFromRegistry().then(() => {
                    node.status({});
                    done();
                }).catch(() => done());
            }
        });
    }
    
    RED.nodes.registerType("nmos-is12-control", NMOSIS12ControlNode);
};