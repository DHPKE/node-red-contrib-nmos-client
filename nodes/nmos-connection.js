const axios = require('axios');

module.exports = function(RED) {
    function NMOSConnectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.operation = config.operation || 'activate';
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        // Resolve resource name to UUID if needed
        const resolveResourceId = async (identifier, resourceType) => {
            if (!identifier) {
                return null;
            }
            
            // Check if identifier is already a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidPattern.test(identifier)) {
                return identifier; // Already a UUID
            }
            
            // Identifier is a name/label, need to query for it
            try {
                node.status({fill: "blue", shape: "dot", text: `resolving ${resourceType}...`});
                
                const encodeRQLNameChars = (str) => {
                    return encodeURIComponent(str.toString()).replace(/[!'()]/g, c => {
                        return '%' + c.charCodeAt(0).toString(16);
                    });
                };
                
                const encodedName = encodeRQLNameChars(identifier);
                const queryUrl = `${node.registry.getQueryApiUrl()}/${resourceType}/?query.rql=eq(label,string:${encodedName})`;
                
                const response = await axios.get(queryUrl, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000
                });
                
                if (response.data && response.data.length > 0) {
                    if (response.data.length > 1) {
                        node.warn(`Multiple ${resourceType} found with label "${identifier}", using first match`);
                    }
                    return response.data[0].id;
                } else {
                    throw new Error(`No ${resourceType} found with label "${identifier}"`);
                }
            } catch (error) {
                if (error.response) {
                    throw new Error(`Failed to resolve ${resourceType} "${identifier}": HTTP ${error.response.status}`);
                }
                throw new Error(`Failed to resolve ${resourceType} "${identifier}": ${error.message}`);
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
                
                // Remove trailing slash
                if (baseHref.endsWith('/')) {
                    baseHref = baseHref.slice(0, -1);
                }
                
                // Extract the base URL (everything before /single or /bulk)
                // This handles hrefs like:
                // - http://device/x-nmos/connection/v1.0/
                // - http://device/x-nmos/connection/v1.1/
                // - http://device/x-nmos/connection/
                baseHref = baseHref.replace(/\/(single|bulk)(?:\/.*)?$/, '');
                
                // Remove any version from the path (handles multi-digit versions like v1.10 or v10.0)
                baseHref = baseHref.replace(/\/v\d+\.\d+\/?$/, '');
                
                // Ensure it ends with /connection
                if (!baseHref.endsWith('/connection')) {
                    const parts = baseHref.split('/');
                    const connectionIndex = parts.indexOf('connection');
                    if (connectionIndex !== -1) {
                        baseHref = parts.slice(0, connectionIndex + 1).join('/');
                    } else {
                        throw new Error("Invalid connection API href: missing 'connection' in path");
                    }
                }
                
                // Add the correct version from the control type
                baseHref = `${baseHref}/${apiVersion}`;
                
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
                let receiverId, senderId, operation, options = {};
                
                if (msg.receiverId) {
                    receiverId = msg.receiverId;
                    senderId = msg.senderId;
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
                    throw new Error("Invalid input: receiverId is required");
                }
                
                if (!receiverId) {
                    throw new Error("receiverId is required");
                }
                
                // Resolve receiver and sender IDs (can be names or UUIDs)
                const resolvedReceiverId = await resolveResourceId(receiverId, 'receivers');
                const resolvedSenderId = senderId ? await resolveResourceId(senderId, 'senders') : null;
                
                node.status({fill: "blue", shape: "dot", text: `${operation}...`});
                
                // Get connection API and version
                const connectionInfo = await getConnectionAPI(resolvedReceiverId);
                const stagedUrl = `${connectionInfo.url}/staged`;
                
                node.log(`Using IS-05 ${connectionInfo.version} API`);
                node.log(`PATCH URL: ${stagedUrl}`);
                
                const patchPayload = buildPatchPayload(operation, resolvedSenderId, options, connectionInfo.version);
                
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
                    receiverId: resolvedReceiverId,
                    senderId: resolvedSenderId,
                    receiverName: receiverId !== resolvedReceiverId ? receiverId : undefined,
                    senderName: senderId && senderId !== resolvedSenderId ? senderId : undefined,
                    apiVersion: connectionInfo.version,
                    staged: response.data,
                    connectionAPI: connectionInfo.url
                };
                msg.statusCode = response.status;
                
                node.status({
                    fill: "green", 
                    shape: "dot", 
                    text: `${operation} OK`
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