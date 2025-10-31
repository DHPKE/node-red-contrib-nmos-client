const axios = require('axios');

module.exports = function(RED) {
    function NMOSConnectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.operation = config.operation || 'activate';
        
        // Cache for resolved names (cleared on deploy)
        this.nameCache = {
            receivers: {},
            senders: {}
        };
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        // Clear cache on node close/redeploy
        node.on('close', function() {
            node.nameCache.receivers = {};
            node.nameCache.senders = {};
        });
        
        const resolveReceiverByName = async (name) => {
            // Check cache first
            if (node.nameCache.receivers[name]) {
                node.log(`Using cached receiver ID for "${name}"`);
                const cachedId = node.nameCache.receivers[name];
                return { id: cachedId, label: name };
            }
            
            try {
                // Use basic query parameter for label filtering (more compatible than RQL)
                const encodedName = encodeURIComponent(name);
                const url = `${node.registry.getQueryApiUrl()}/receivers/?label=${encodedName}`;
                const response = await axios.get(url, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000
                });
                
                // Still filter client-side for exact match since registry may do partial matching
                const matches = response.data.filter(receiver => receiver.label === name);
                
                if (matches.length === 0) {
                    throw new Error(`Receiver '${name}' not found in registry`);
                }
                
                if (matches.length > 1) {
                    const matchList = matches.map(r => `  - ${r.label} (ID: ${r.id})`).join('\n');
                    throw new Error(`Multiple receivers found with name '${name}':\n${matchList}`);
                }
                
                const receiverId = matches[0].id;
                node.nameCache.receivers[name] = receiverId;
                node.log(`Resolved receiver "${name}" to ID ${receiverId}`);
                return { id: receiverId, label: name };
                
            } catch (error) {
                if (error.message.includes('not found') || error.message.includes('Multiple receivers')) {
                    throw error;
                }
                throw new Error(`Failed to resolve receiver name '${name}': ${error.message}`);
            }
        };
        
        const resolveSenderByName = async (name) => {
            // Check cache first
            if (node.nameCache.senders[name]) {
                node.log(`Using cached sender ID for "${name}"`);
                const cachedId = node.nameCache.senders[name];
                return { id: cachedId, label: name };
            }
            
            try {
                // Use basic query parameter for label filtering (more compatible than RQL)
                const encodedName = encodeURIComponent(name);
                const url = `${node.registry.getQueryApiUrl()}/senders/?label=${encodedName}`;
                const response = await axios.get(url, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000
                });
                
                // Still filter client-side for exact match since registry may do partial matching
                const matches = response.data.filter(sender => sender.label === name);
                
                if (matches.length === 0) {
                    throw new Error(`Sender '${name}' not found in registry`);
                }
                
                if (matches.length > 1) {
                    const matchList = matches.map(s => `  - ${s.label} (ID: ${s.id})`).join('\n');
                    throw new Error(`Multiple senders found with name '${name}':\n${matchList}`);
                }
                
                const senderId = matches[0].id;
                node.nameCache.senders[name] = senderId;
                node.log(`Resolved sender "${name}" to ID ${senderId}`);
                return { id: senderId, label: name };
                
            } catch (error) {
                if (error.message.includes('not found') || error.message.includes('Multiple senders')) {
                    throw error;
                }
                throw new Error(`Failed to resolve sender name '${name}': ${error.message}`);
            }
        };
        
        const getConnectionAPI = async (receiverId) => {
            try {
                const receiverUrl = `${node.registry.getQueryApiUrl()}/receivers/${receiverId}`;
                const receiverResp = await axios.get(receiverUrl, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000
                });
                
                const receiver = receiverResp.data;
                
                if (!receiver.device_id) {
                    throw new Error("Receiver has no device_id");
                }
                
                const deviceUrl = `${node.registry.getQueryApiUrl()}/devices/${receiver.device_id}`;
                const deviceResp = await axios.get(deviceUrl, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000
                });
                
                const device = deviceResp.data;
                
                if (!device.controls || device.controls.length === 0) {
                    throw new Error("Device has no IS-05 controls");
                }
                
                // Find IS-05 connection control and extract version
                const control = device.controls.find(c => 
                    c.type && c.type.includes('urn:x-nmos:control:sr-ctrl')
                );
                
                if (!control || !control.href) {
                    throw new Error("Device does not support IS-05 connection control");
                }
                
                // Extract API version from control type
                // Format: urn:x-nmos:control:sr-ctrl/v1.0 or urn:x-nmos:control:sr-ctrl/v1.1
                let apiVersion = 'v1.1'; // Default to v1.1
                const versionMatch = control.type.match(/\/v(\d+\.\d+)/);
                if (versionMatch) {
                    apiVersion = `v${versionMatch[1]}`;
                }
                
                node.log(`Device supports IS-05 ${apiVersion}`);
                
                let baseHref = control.href;
                if (baseHref.endsWith('/')) {
                    baseHref = baseHref.slice(0, -1);
                }
                
                // Check if base href already includes version
                if (!baseHref.includes('/v1.')) {
                    // Append version to base href
                    baseHref = baseHref.replace('/connection', `/connection/${apiVersion}`);
                }
                
                return {
                    url: `${baseHref}/single/receivers/${receiverId}`,
                    version: apiVersion
                };
                
            } catch (error) {
                throw new Error(`Failed to get connection API: ${error.message}`);
            }
        };
        
        const buildPatchPayload = (operation, senderId, options, apiVersion) => {
            const payload = {};
            
            switch (operation) {
                case 'connect':
                case 'activate':
                    if (!senderId) {
                        throw new Error("senderId is required for connect/activate operation");
                    }
                    payload.sender_id = senderId;
                    payload.master_enable = true;
                    payload.activation = {
                        mode: 'activate_immediate'
                    };
                    break;
                    
                case 'stage':
                    if (senderId !== undefined) {
                        payload.sender_id = senderId;
                    }
                    if (options.master_enable !== undefined) {
                        payload.master_enable = options.master_enable;
                    }
                    payload.activation = {
                        mode: null
                    };
                    break;
                    
                case 'disconnect':
                    payload.sender_id = null;
                    payload.master_enable = false;
                    payload.activation = {
                        mode: 'activate_immediate'
                    };
                    break;
                    
                case 'scheduled':
                    if (!senderId) {
                        throw new Error("senderId is required for scheduled operation");
                    }
                    if (!options.requested_time) {
                        throw new Error("requested_time is required for scheduled operation");
                    }
                    payload.sender_id = senderId;
                    payload.master_enable = true;
                    payload.activation = {
                        mode: options.activation_mode || 'activate_scheduled_absolute',
                        requested_time: options.requested_time
                    };
                    break;
                    
                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }
            
            if (options.transport_params) {
                payload.transport_params = Array.isArray(options.transport_params) 
                    ? options.transport_params 
                    : [options.transport_params];
            }
            
            if (options.transport_file) {
                payload.transport_file = {
                    data: options.transport_file,
                    type: options.transport_file_type || 'application/sdp'
                };
            }
            
            return payload;
        };
        
        node.on('input', async function(msg) {
            try {
                let receiverId, senderId, receiverName, senderName, operation, options = {};
                
                // Parse input from msg properties or payload
                if (msg.receiverId || msg.receiverName) {
                    receiverId = msg.receiverId;
                    senderId = msg.senderId;
                    receiverName = msg.receiverName;
                    senderName = msg.senderName;
                    operation = msg.operation || node.operation;
                    options = {
                        master_enable: msg.master_enable,
                        transport_params: msg.transport_params || msg.transportParams,
                        transport_file: msg.transport_file || msg.transportFile,
                        transport_file_type: msg.transport_file_type,
                        requested_time: msg.requested_time,
                        activation_mode: msg.activation_mode
                    };
                }
                else if (msg.payload && typeof msg.payload === 'object') {
                    receiverId = msg.payload.receiverId || msg.payload.receiver_id;
                    senderId = msg.payload.senderId || msg.payload.sender_id;
                    receiverName = msg.payload.receiverName || msg.payload.receiver_name;
                    senderName = msg.payload.senderName || msg.payload.sender_name;
                    operation = msg.payload.operation || node.operation;
                    options = {
                        master_enable: msg.payload.master_enable,
                        transport_params: msg.payload.transport_params || msg.payload.transportParams,
                        transport_file: msg.payload.transport_file || msg.payload.transportFile,
                        transport_file_type: msg.payload.transport_file_type,
                        requested_time: msg.payload.requested_time,
                        activation_mode: msg.payload.activation_mode
                    };
                }
                else {
                    throw new Error("Invalid input: receiverId or receiverName is required");
                }
                
                // Validate that we have receiver info
                if (!receiverId && !receiverName) {
                    throw new Error("receiverId or receiverName is required");
                }
                
                // Resolve names to IDs (ID takes precedence if both provided)
                let receiverLabel = receiverName;
                let senderLabel = senderName;
                
                if (!receiverId && receiverName) {
                    node.status({fill: "blue", shape: "dot", text: `resolving receiver...`});
                    const resolved = await resolveReceiverByName(receiverName);
                    receiverId = resolved.id;
                    receiverLabel = resolved.label;
                }
                
                if (!senderId && senderName) {
                    node.status({fill: "blue", shape: "dot", text: `resolving sender...`});
                    const resolved = await resolveSenderByName(senderName);
                    senderId = resolved.id;
                    senderLabel = resolved.label;
                }
                
                // Build status text with names if available
                let statusText = operation;
                if (operation === 'activate' || operation === 'connect') {
                    if (receiverLabel && senderLabel) {
                        statusText = `${senderLabel} → ${receiverLabel}`;
                    } else if (receiverLabel) {
                        statusText = `connecting ${receiverLabel}`;
                    }
                } else if (operation === 'disconnect') {
                    if (receiverLabel) {
                        statusText = `disconnecting ${receiverLabel}`;
                    }
                }
                
                node.status({fill: "blue", shape: "dot", text: `${statusText}...`});
                
                // Get connection API and version
                const connectionInfo = await getConnectionAPI(receiverId);
                const stagedUrl = `${connectionInfo.url}/staged`;
                
                node.log(`Using IS-05 ${connectionInfo.version} API`);
                node.log(`PATCH URL: ${stagedUrl}`);
                
                const patchPayload = buildPatchPayload(operation, senderId, options, connectionInfo.version);
                
                node.status({fill: "blue", shape: "dot", text: "sending..."});
                
                const response = await axios.patch(stagedUrl, patchPayload, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 15000,
                    validateStatus: (status) => status >= 200 && status < 500
                });
                
                if (response.status !== 200) {
                    throw new Error(`PATCH failed with HTTP ${response.status}: ${JSON.stringify(response.data)}`);
                }
                
                msg.payload = {
                    success: true,
                    operation: operation,
                    receiverId: receiverId,
                    senderId: senderId,
                    receiverName: receiverLabel,
                    senderName: senderLabel,
                    apiVersion: connectionInfo.version,
                    staged: response.data,
                    connectionAPI: connectionInfo.url
                };
                msg.statusCode = response.status;
                
                // Build success status text
                let successText = `${operation} ✓`;
                if (operation === 'activate' || operation === 'connect') {
                    if (receiverLabel && senderLabel) {
                        successText = `${senderLabel} → ${receiverLabel} ✓`;
                    } else if (receiverLabel) {
                        successText = `connected ${receiverLabel} ✓`;
                    }
                } else if (operation === 'disconnect') {
                    if (receiverLabel) {
                        successText = `disconnected ${receiverLabel} ✓`;
                    }
                }
                
                node.status({
                    fill: "green", 
                    shape: "dot", 
                    text: successText
                });
                
                node.send(msg);
                
            } catch (error) {
                node.status({fill: "red", shape: "ring", text: "failed"});
                
                let errorMsg = error.message;
                
                if (error.response) {
                    const errData = error.response.data;
                    errorMsg = `HTTP ${error.response.status}: ${errData.error || errData.code || JSON.stringify(errData)}`;
                    
                    // Special handling for version mismatch
                    if (error.response.status === 409 && errData.error && errData.error.includes('v1.0 request is not permitted for a v1.1 resource')) {
                        errorMsg = `API version mismatch: Device requires IS-05 v1.1 but received v1.0 request. This has been automatically detected and should work on retry.`;
                    }
                    
                    msg.payload = {
                        success: false,
                        error: errData,
                        statusCode: error.response.status,
                        message: errorMsg
                    };
                    msg.statusCode = error.response.status;
                } else if (error.code === 'ECONNREFUSED') {
                    errorMsg = `Cannot connect to registry: ${node.registry.registryUrl}`;
                    msg.payload = {
                        success: false,
                        error: errorMsg
                    };
                } else {
                    msg.payload = {
                        success: false,
                        error: error.message
                    };
                }
                
                node.error(errorMsg, msg);
                node.send(msg);
            }
        });
    }
    
    RED.nodes.registerType("nmos-connection", NMOSConnectionNode);
};