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
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }

        // Get the group node (required for FlowFuse Dashboard)
        const group = RED.nodes.getNode(config.group);
        
        if (!group) {
            node.error("No Dashboard group configured");
            node.status({fill: "red", shape: "ring", text: "no group"});
            return;
        }

        // Define event handlers for FlowFuse Dashboard
        const evts = {
            onAction: true, // Enable action events from UI
            onInput: function (msg, send) {
                // Handle messages coming INTO the node
                if (msg.payload && msg.payload.action === 'route') {
                    const { receiverId, senderId, operation } = msg.payload;
                    
                    if (!receiverId) {
                        node.error("receiverId is required for routing");
                        return;
                    }
                    
                    node.status({fill: "blue", shape: "dot", text: "routing..."});
                    
                    // Output message in format expected by nmos-connection node
                    const routingMsg = {
                        receiverId: receiverId,
                        senderId: senderId || null,
                        operation: operation || (senderId ? 'activate' : 'disconnect')
                    };
                    
                    send(routingMsg);
                    
                    setTimeout(() => {
                        node.status({fill: "green", shape: "dot", text: "ready"});
                    }, 2000);
                    
                } else if (msg.payload && msg.payload.action === 'refresh') {
                    node.status({fill: "blue", shape: "ring", text: "refreshing..."});
                    setTimeout(() => {
                        node.status({fill: "green", shape: "dot", text: "ready"});
                    }, 1000);
                }
                
                // Pass through if configured
                if (config.passthru) {
                    send(msg);
                }
            },
            beforeSend: function (msg) {
                // Process messages before sending to frontend
                return msg;
            }
        };

        // Register with FlowFuse Dashboard group
        group.register(node, config, evts);
        
        node.status({fill: "green", shape: "dot", text: "ready"});
    }
    
    RED.nodes.registerType("nmos-matrix-ui", NMOSMatrixUINode);
};
