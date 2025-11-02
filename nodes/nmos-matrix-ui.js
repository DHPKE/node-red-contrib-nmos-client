const axios = require('axios');

module.exports = function(RED) {
    // API endpoint to get all resources (senders and receivers) with names
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
            
            // Map to names (labels) instead of UUIDs for display
            const senders = sendersResp.data.map(s => ({
                id: s.id,
                name: s.label || s.id, // Use label as name
                label: s.label || s.id,
                description: s.description || '',
                flow_id: s.flow_id
            }));
            
            const receivers = receiversResp.data.map(r => ({
                id: r.id,
                name: r.label || r.id, // Use label as name
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
                        senderId: receiver.subscription.sender_id,
                        receiverName: receiver.label || receiver.id,
                        senderName: receiver.subscription.sender_id // Will be resolved in Vue component
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
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }

        const group = RED.nodes.getNode(config.group);
        
        if (!group) {
            node.error("No Dashboard group configured");
            node.status({fill: "red", shape: "ring", text: "no group"});
            return;
        }

        // Pass registry ID to the UI component
        const ui_config = {
            ...config,
            registry: config.registry
        };

        // Event handlers for FlowFuse Dashboard
        const evts = {
            onAction: true,
            onInput: function (msg, send) {
                // Handle messages TO the widget from Node-RED
                if (config.passthru) {
                    send(msg);
                }
            },
            beforeSend: function (msg) {
                // Process before sending to UI
                return msg;
            }
        };

        // Register the UI widget with FlowFuse Dashboard
        const done = group.register(node, ui_config, evts);
        
        // Handle incoming messages from the Vue component (routing actions)
        node.on('input', function(msg) {
            if (msg.payload && msg.payload.action === 'route') {
                // Forward routing command to connection node
                const routingMsg = {
                    payload: {
                        receiverId: msg.payload.receiverId,
                        senderId: msg.payload.senderId,
                        operation: msg.payload.operation || 'activate'
                    }
                };
                
                node.status({
                    fill: "blue", 
                    shape: "dot", 
                    text: `routing: ${msg.payload.operation}`
                });
                
                node.send(routingMsg);
                
                // Reset status after 2 seconds
                setTimeout(() => {
                    node.status({fill: "green", shape: "dot", text: "ready"});
                }, 2000);
            }
        });
        
        node.on('close', done);
        
        node.status({fill: "green", shape: "dot", text: "ready"});
    }
    
    RED.nodes.registerType("nmos-matrix-ui", NMOSMatrixUINode);
};