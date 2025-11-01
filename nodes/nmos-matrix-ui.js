const axios = require('axios');

module.exports = function(RED) {
    // API endpoint to get all resources (senders and receivers)
    RED.httpAdmin.get('/nmos-matrix-ui/resources', async function(req, res) {
        try {
            const registryId = req.query.registry;
            const registry = RED.nodes.getNode(registryId);
            
            if (!registry) {
                return res.status(400).json({error: 'Registry not found'});
            }
            
            const baseUrl = registry.getQueryApiUrl();
            const headers = registry.getAuthHeaders();
            
            // Fetch senders and receivers in parallel
            const [sendersResp, receiversResp] = await Promise.all([
                axios.get(`${baseUrl}/senders`, {
                    headers: headers,
                    timeout: 10000,
                    params: { 'paging.limit': 500 }
                }),
                axios.get(`${baseUrl}/receivers`, {
                    headers: headers,
                    timeout: 10000,
                    params: { 'paging.limit': 500 }
                })
            ]);
            
            const senders = sendersResp.data.map(s => ({
                id: s.id,
                label: s.label || s.id,
                description: s.description || '',
                flow_id: s.flow_id
            }));
            
            const receivers = receiversResp.data.map(r => ({
                id: r.id,
                label: r.label || r.id,
                description: r.description || '',
                subscription: r.subscription || {}
            }));
            
            res.json({ senders, receivers });
        } catch (error) {
            console.error('Error fetching resources:', error.message);
            res.status(500).json({error: error.message});
        }
    });
    
    // API endpoint to get current active connections
    RED.httpAdmin.get('/nmos-matrix-ui/connections', async function(req, res) {
        try {
            const registryId = req.query.registry;
            const registry = RED.nodes.getNode(registryId);
            
            if (!registry) {
                return res.status(400).json({error: 'Registry not found'});
            }
            
            const baseUrl = registry.getQueryApiUrl();
            const headers = registry.getAuthHeaders();
            
            // Fetch receivers with subscription information
            const receiversResp = await axios.get(`${baseUrl}/receivers`, {
                headers: headers,
                timeout: 10000,
                params: { 'paging.limit': 500 }
            });
            
            // Extract active connections from receiver subscriptions
            const connections = [];
            receiversResp.data.forEach(receiver => {
                if (receiver.subscription && 
                    receiver.subscription.active === true && 
                    receiver.subscription.sender_id) {
                    connections.push({
                        receiverId: receiver.id,
                        senderId: receiver.subscription.sender_id
                    });
                }
            });
            
            res.json({ connections });
        } catch (error) {
            console.error('Error fetching connections:', error.message);
            res.status(500).json({error: error.message});
        }
    });
    
    function NMOSMatrixUINode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.group = config.group;
        this.width = config.width || 12;
        this.height = config.height || 8;
        
        // Get Dashboard 2 plugin
        const ui = RED.plugins.get('node-red-dashboard-2');
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        if (!ui) {
            node.error("Dashboard 2 plugin not found");
            node.status({fill: "red", shape: "ring", text: "no dashboard"});
            return;
        }
        
        if (!this.group) {
            node.error("No Dashboard group configured");
            node.status({fill: "red", shape: "ring", text: "no group"});
            return;
        }
        
        // Get the group node
        const group = RED.nodes.getNode(this.group);
        if (!group) {
            node.error("Dashboard group not found");
            node.status({fill: "red", shape: "ring", text: "group error"});
            return;
        }
        
        // Widget configuration
        const widgetConfig = {
            type: 'nmos-matrix-ui',
            props: {
                registry: config.registry
            }
        };
        
        // Event handlers for Dashboard 2
        const evts = {
            onInput: function(msg, send) {
                // Handle incoming messages from Node-RED flows
                node.emit('input', msg);
            },
            onAction: function(msg) {
                // Handle actions from the UI widget
                node.emit('input', msg);
            }
        };
        
        // Register widget with Dashboard 2
        ui.register(group, node, widgetConfig, evts);
        
        node.status({fill: "green", shape: "dot", text: "ready"});
        
        node.on('input', async function(msg) {
            try {
                // Handle routing actions from the UI
                if (msg.payload && msg.payload.action === 'route') {
                    const { receiverId, senderId, operation } = msg.payload;
                    
                    if (!receiverId) {
                        throw new Error("receiverId is required for routing");
                    }
                    
                    node.status({fill: "blue", shape: "dot", text: "routing..."});
                    
                    // Output message in format expected by nmos-connection node
                    const routingMsg = {
                        receiverId: receiverId,
                        senderId: senderId || null,
                        operation: operation || (senderId ? 'activate' : 'disconnect')
                    };
                    
                    node.send(routingMsg);
                    
                    // Set status based on operation
                    setTimeout(() => {
                        node.status({fill: "green", shape: "dot", text: "ready"});
                    }, 2000);
                    
                } else if (msg.payload && msg.payload.action === 'refresh') {
                    // Handle refresh action - notify UI to reload
                    node.status({fill: "blue", shape: "ring", text: "refreshing..."});
                    
                    // Emit refresh message to UI if Dashboard 2 is available
                    if (ui) {
                        ui.emit('msg-input:' + node.id, msg);
                    }
                    
                    setTimeout(() => {
                        node.status({fill: "green", shape: "dot", text: "ready"});
                    }, 1000);
                    
                } else {
                    // Pass through other messages and emit to UI
                    if (ui) {
                        ui.emit('msg-input:' + node.id, msg);
                    }
                    node.send(msg);
                }
                
            } catch (error) {
                node.status({fill: "red", shape: "ring", text: "error"});
                node.error(error.message, msg);
                
                // Send error message
                msg.payload = {
                    success: false,
                    error: error.message
                };
                node.send(msg);
            }
        });
        
        node.on('close', function() {
            // Deregister widget from Dashboard 2
            if (ui) {
                ui.deregister(node);
            }
            node.status({});
        });
    }
    
    RED.nodes.registerType("nmos-matrix-ui", NMOSMatrixUINode);
};
