const mqtt = require('mqtt');
const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

module.exports = function(RED) {
    function NMOSIS12ControlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.mqttBroker = config.mqttBroker || 'mqtt://localhost:1883';
        this.deviceLabel = config.deviceLabel || 'Node-RED IS-12 Device';
        this.deviceDescription = config.deviceDescription || 'IS-12 Control Device';
        this.deviceId = config.deviceId || uuidv4();
        this.nodeId = config.nodeId || uuidv4();
        this.controlType = config.controlType || 'generic';
        
        let mqttClient = null;
        let registrationComplete = false;
        let heartbeatInterval = null;
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        if (!this.mqttBroker) {
            node.error("No MQTT broker configured");
            node.status({fill: "red", shape: "ring", text: "no mqtt broker"});
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
        
        const getMQTTTopics = () => {
            return {
                command: `x-nmos/nc/${node.deviceId}/commands`,
                response: `x-nmos/nc/${node.deviceId}/responses`,
                notification: `x-nmos/nc/${node.deviceId}/notifications`,
                subscription: `x-nmos/nc/${node.deviceId}/subscriptions`
            };
        };
        
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
                    href: node.mqttBroker
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
        
        const setupMQTT = () => {
            const topics = getMQTTTopics();
            
            node.log('Connecting to MQTT: ' + node.mqttBroker);
            
            try {
                mqttClient = mqtt.connect(node.mqttBroker, {
                    clientId: `nmos-is12-${node.deviceId}`,
                    clean: true,
                    reconnectPeriod: 5000
                });
                
                mqttClient.on('connect', () => {
                    node.log('✓ MQTT connected');
                    if (registrationComplete) {
                        node.status({fill: "green", shape: "dot", text: "connected"});
                    }
                    
                    mqttClient.subscribe(topics.command, (err) => {
                        if (!err) {
                            node.log(`✓ Subscribed to: ${topics.command}`);
                        }
                    });
                });
                
                mqttClient.on('message', (topic, message) => {
                    try {
                        const command = JSON.parse(message.toString());
                        node.log(`◄ Command received`);
                        handleIS12Command(command);
                    } catch (error) {
                        node.error(`MQTT message error: ${error.message}`);
                    }
                });
                
                mqttClient.on('error', (error) => {
                    node.error(`MQTT error: ${error.message}`);
                });
            } catch (error) {
                node.error(`MQTT setup failed: ${error.message}`);
            }
        };
        
        const handleIS12Command = (command) => {
            const topics = getMQTTTopics();
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
            
            if (mqttClient && mqttClient.connected) {
                mqttClient.publish(topics.response, JSON.stringify(response), { qos: 1 });
                node.log(`► Response sent`);
            }
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
            if (!mqttClient || !mqttClient.connected) return;
            
            const topics = getMQTTTopics();
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
            
            mqttClient.publish(topics.notification, JSON.stringify(notification), { qos: 0 });
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
        
        setupMQTT();
        
        registerWithRegistry().then(success => {
            if (success) {
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
                        mqttConnected: mqttClient && mqttClient.connected,
                        mqttBroker: node.mqttBroker,
                        topics: getMQTTTopics(),
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
                    
                case 'send_command':
                    const { targetDevice, command } = msg.payload;
                    const commandTopic = `x-nmos/nc/${targetDevice}/commands`;
                    const ncpCommand = {
                        messageType: 0,
                        commands: [command]
                    };
                    
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(commandTopic, JSON.stringify(ncpCommand), { qos: 1 });
                        node.log(`► Command sent to ${targetDevice}`);
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
            
            if (mqttClient) {
                mqttClient.end(true);
            }
            
            unregisterFromRegistry().then(() => {
                node.status({});
                done();
            }).catch(() => done());
        });
    }
    
    RED.nodes.registerType("nmos-is12-control", NMOSIS12ControlNode);
};