const axios = require('axios');

module.exports = function(RED) {
    function NMOSGetOneNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.resourceType = config.resourceType || 'devices';
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        // Get IS-05 connection endpoints for sender/receiver
        const getConnectionEndpoints = async (deviceId, resourceId, resourceType) => {
            try {
                const deviceUrl = `${node.registry.getQueryApiUrl()}/devices/${deviceId}`;
                const deviceResponse = await axios.get(deviceUrl, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000
                });
                
                const device = deviceResponse.data;
                
                if (!device.controls || device.controls.length === 0) {
                    return null;
                }
                
                const connectionControl = device.controls.find(c => 
                    c.type && c.type.includes('urn:x-nmos:control:sr-ctrl')
                );
                
                if (!connectionControl || !connectionControl.href) {
                    return null;
                }
                
                let baseHref = connectionControl.href;
                if (baseHref.endsWith('/')) {
                    baseHref = baseHref.slice(0, -1);
                }
                
                const endpoints = ['active', 'staged', 'constraints', 'transporttype'];
                const endpointData = {};
                const headers = node.registry.getAuthHeaders();
                
                for (const endpoint of endpoints) {
                    try {
                        const url = `${baseHref}/single/${resourceType}/${resourceId}/${endpoint}`;
                        const response = await axios.get(url, {
                            headers: headers,
                            timeout: 5000,
                            validateStatus: (status) => status < 500
                        });
                        
                        if (response.status === 200) {
                            endpointData[`$${endpoint}`] = response.data;
                        }
                    } catch (err) {
                        // Endpoint might not exist
                    }
                }
                
                endpointData.$connectionAPI = `${baseHref}/single/${resourceType}/${resourceId}`;
                
                if (!endpointData.$transporttype) {
                    endpointData.$transporttype = 'urn:x-nmos:transport:rtp';
                }
                
                return endpointData;
            } catch (error) {
                node.warn(`Failed to get connection endpoints: ${error.message}`);
                return null;
            }
        };
        
        node.on('input', async function(msg) {
            try {
                const resourceType = msg.resourceType || node.resourceType;
                let resourceId = msg.resourceId || msg.payload;
                
                if (typeof resourceId === 'object' && resourceId.id) {
                    resourceId = resourceId.id;
                }
                
                if (!resourceId || typeof resourceId !== 'string') {
                    throw new Error('Resource ID is required (must be a string UUID)');
                }
                
                node.status({fill: "blue", shape: "dot", text: "fetching..."});
                
                const url = `${node.registry.getQueryApiUrl()}/${resourceType}/${resourceId}`;
                const response = await axios.get(url, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 15000,
                    validateStatus: function (status) {
                        return status >= 200 && status < 500;
                    }
                });
                
                if (response.status === 404) {
                    throw new Error(`Resource not found: ${resourceType}/${resourceId}`);
                }
                
                if (response.status !== 200) {
                    throw new Error(`HTTP ${response.status}: ${response.data.error || response.statusText}`);
                }
                
                let data = response.data;
                
                if ((resourceType === 'receivers' || resourceType === 'senders') && data.device_id) {
                    node.status({fill: "blue", shape: "dot", text: "getting IS-05..."});
                    
                    const connectionData = await getConnectionEndpoints(
                        data.device_id,
                        resourceId,
                        resourceType
                    );
                    
                    if (connectionData) {
                        data = { ...data, ...connectionData };
                    } else {
                        data.$connectionAPI = null;
                    }
                }
                
                msg.payload = data;
                msg.statusCode = response.status;
                msg.resourceType = resourceType;
                msg.resourceId = resourceId;
                
                node.status({fill: "green", shape: "dot", text: "success"});
                node.send(msg);
                
            } catch (error) {
                node.status({fill: "red", shape: "ring", text: "error"});
                
                let errorMsg = error.message;
                if (error.response) {
                    errorMsg = `HTTP ${error.response.status}: ${error.response.data.error || error.response.statusText}`;
                    msg.statusCode = error.response.status;
                    msg.payload = {
                        error: error.response.data,
                        statusCode: error.response.status
                    };
                } else if (error.code === 'ECONNREFUSED') {
                    errorMsg = `Connection refused: ${node.registry.registryUrl}`;
                    msg.payload = { error: errorMsg };
                } else {
                    msg.payload = { error: error.message };
                }
                
                node.error(errorMsg, msg);
                node.send(msg);
            }
        });
    }
    
    RED.nodes.registerType("nmos-get-one", NMOSGetOneNode);
};