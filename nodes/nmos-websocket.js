const WebSocket = require('ws');
const axios = require('axios');

module.exports = function(RED) {
    function NMOSWebSocketNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.resourceType = config.resourceType || 'devices';
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        let ws = null;
        let reconnectTimer = null;
        let subscriptionId = null;
        let isClosing = false;
        
        async function createSubscription() {
            try {
                const subscriptionUrl = `${node.registry.getQueryApiUrl()}/subscriptions`;
                
                const subscriptionData = {
                    max_update_rate_ms: 100,
                    resource_path: `/${node.resourceType}`,
                    params: {},
                    persist: false,
                    secure: false
                };
                
                node.log(`Creating subscription at: ${subscriptionUrl}`);
                
                const response = await axios.post(subscriptionUrl, subscriptionData, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 30000,
                    validateStatus: function (status) {
                        return status >= 200 && status < 500;
                    }
                });
                
                if (response.status !== 200 && response.status !== 201) {
                    throw new Error(`HTTP ${response.status}: ${response.data.error || response.statusText}`);
                }
                
                const subscription = response.data;
                if (!subscription.id || !subscription.ws_href) {
                    throw new Error('Invalid subscription response: missing id or ws_href');
                }
                
                node.log(`Subscription created: ${subscription.id}`);
                node.log(`WebSocket href: ${subscription.ws_href}`);
                
                return {
                    id: subscription.id,
                    ws_href: subscription.ws_href
                };
                
            } catch (error) {
                let errorMsg = error.message;
                if (error.response) {
                    errorMsg = `HTTP ${error.response.status}: ${error.response.data.error || error.response.statusText}`;
                } else if (error.code === 'ECONNREFUSED') {
                    errorMsg = `Connection refused: ${node.registry.registryUrl}`;
                }
                throw new Error(`Failed to create subscription: ${errorMsg}`);
            }
        }
        
        async function deleteSubscription(subId) {
            if (!subId) return;
            
            try {
                const subscriptionUrl = `${node.registry.getQueryApiUrl()}/subscriptions/${subId}`;
                
                node.log(`Deleting subscription: ${subId}`);
                
                await axios.delete(subscriptionUrl, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000,
                    validateStatus: function (status) {
                        return status >= 200 && status < 500;
                    }
                });
                
                node.log(`Subscription deleted: ${subId}`);
                
            } catch (error) {
                node.error(`Failed to delete subscription ${subId}: ${error.message}`);
            }
        }
        
        async function connect() {
            if (isClosing) return;
            
            try {
                // Step 1: Create HTTP subscription
                node.status({fill: "yellow", shape: "ring", text: "subscribing..."});
                
                const subscription = await createSubscription();
                subscriptionId = subscription.id;
                
                // Step 2: Connect to the WebSocket URL returned from subscription
                const wsUrl = subscription.ws_href;
                node.status({fill: "yellow", shape: "ring", text: "connecting..."});
                node.log(`Connecting to WebSocket: ${wsUrl}`);
                
                const wsOptions = {
                    headers: {}
                };
                
                const credentials = node.registry.credentials;
                if (credentials && credentials.token) {
                    wsOptions.headers['Authorization'] = `Bearer ${credentials.token}`;
                } else if (credentials && credentials.username && credentials.password) {
                    const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
                    wsOptions.headers['Authorization'] = `Basic ${auth}`;
                }
                
                ws = new WebSocket(wsUrl, wsOptions);
                
                ws.on('open', function() {
                    node.status({fill: "green", shape: "dot", text: "connected"});
                    node.log('WebSocket connected');
                });
                
                ws.on('message', function(data) {
                    try {
                        const message = JSON.parse(data.toString());
                        
                        // Handle grain messages (resource updates)
                        if (message.grain_type || message.grain) {
                            const msg = {
                                payload: message,
                                topic: node.resourceType,
                                subscriptionId: subscriptionId
                            };
                            node.send(msg);
                        }
                    } catch (error) {
                        node.error(`Error parsing WebSocket message: ${error.message}`);
                    }
                });
                
                ws.on('error', function(error) {
                    if (!isClosing) {
                        node.status({fill: "red", shape: "ring", text: "error"});
                        node.error(`WebSocket error: ${error.message}`);
                    }
                });
                
                ws.on('close', async function(code, reason) {
                    if (!isClosing) {
                        node.status({fill: "yellow", shape: "ring", text: "disconnected"});
                        node.log(`WebSocket closed: ${code} - ${reason}`);
                        
                        // Clean up old subscription
                        const oldSubId = subscriptionId;
                        subscriptionId = null;
                        ws = null;
                        
                        if (oldSubId) {
                            await deleteSubscription(oldSubId);
                        }
                        
                        if (!reconnectTimer) {
                            node.log('Reconnecting in 5 seconds...');
                            reconnectTimer = setTimeout(() => {
                                reconnectTimer = null;
                                connect();
                            }, 5000);
                        }
                    }
                });
                
            } catch (error) {
                node.error(`Connection error: ${error.message}`);
                node.status({fill: "red", shape: "ring", text: "error"});
                
                // Clean up subscription if it was created
                if (subscriptionId) {
                    await deleteSubscription(subscriptionId);
                    subscriptionId = null;
                }
                
                if (!reconnectTimer && !isClosing) {
                    node.log('Reconnecting in 5 seconds...');
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        connect();
                    }, 5000);
                }
            }
        }
        
        connect();
        
        node.on('close', async function(done) {
            isClosing = true;
            
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            
            if (ws) {
                ws.close();
                ws = null;
            }
            
            // Delete the subscription to clean up resources
            if (subscriptionId) {
                await deleteSubscription(subscriptionId);
                subscriptionId = null;
            }
            
            node.status({});
            done();
        });
    }
    
    RED.nodes.registerType("nmos-websocket", NMOSWebSocketNode);
};