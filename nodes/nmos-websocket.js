const WebSocket = require('ws');

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
        
        function connect() {
            if (isClosing) return;
            
            try {
                let registryUrl = node.registry.registryUrl
                    .replace(/^http:\/\//, 'ws://')
                    .replace(/^https:\/\//, 'wss://');
                
                const apiVersion = node.registry.queryApiVersion;
                const wsUrl = `${registryUrl}/x-nmos/query/${apiVersion}/subscriptions`;
                
                node.status({fill: "yellow", shape: "ring", text: "connecting..."});
                node.log(`Connecting to: ${wsUrl}`);
                
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
                    
                    const subscription = {
                        max_update_rate_ms: 100,
                        resource_path: `/${node.resourceType}`,
                        params: {},
                        persist: false,
                        secure: false
                    };
                    
                    ws.send(JSON.stringify(subscription));
                    node.log(`Subscription request sent for: ${node.resourceType}`);
                });
                
                ws.on('message', function(data) {
                    try {
                        const message = JSON.parse(data.toString());
                        
                        if (message.subscription_id || message.id) {
                            subscriptionId = message.subscription_id || message.id;
                            node.log(`Subscription confirmed: ${subscriptionId}`);
                            
                            if (message.ws_href) {
                                node.log(`WebSocket href: ${message.ws_href}`);
                            }
                            return;
                        }
                        
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
                
                ws.on('close', function(code, reason) {
                    if (!isClosing) {
                        node.status({fill: "yellow", shape: "ring", text: "disconnected"});
                        node.log(`WebSocket closed: ${code} - ${reason}`);
                        
                        subscriptionId = null;
                        ws = null;
                        
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
                
                if (!reconnectTimer && !isClosing) {
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        connect();
                    }, 5000);
                }
            }
        }
        
        connect();
        
        node.on('close', function(done) {
            isClosing = true;
            
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            
            if (ws) {
                ws.close();
                ws = null;
            }
            
            node.status({});
            done();
        });
    }
    
    RED.nodes.registerType("nmos-websocket", NMOSWebSocketNode);
};