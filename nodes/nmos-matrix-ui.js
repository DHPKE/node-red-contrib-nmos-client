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
        
        // Get the group node
        const group = RED.nodes.getNode(config.group);
        if (!group) {
            node.error("No Dashboard group configured");
            node.status({fill: "red", shape: "ring", text: "no group"});
            return;
        }
        
        // Helper function to process messages
        const processMessage = async function(msg, send) {
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
                    
                    send(routingMsg);
                    
                    // Set status based on operation
                    setTimeout(() => {
                        node.status({fill: "green", shape: "dot", text: "ready"});
                    }, 2000);
                    
                } else if (msg.payload && msg.payload.action === 'refresh') {
                    // Handle refresh action
                    node.status({fill: "blue", shape: "ring", text: "refreshing..."});
                    
                    setTimeout(() => {
                        node.status({fill: "green", shape: "dot", text: "ready"});
                    }, 1000);
                    
                } else {
                    // Pass through other messages
                    send(msg);
                }
                
            } catch (error) {
                node.status({fill: "red", shape: "ring", text: "error"});
                node.error(error.message, msg);
                
                // Send error message
                msg.payload = {
                    success: false,
                    error: error.message
                };
                send(msg);
            }
        };
        
        // Event handlers for FlowFuse Dashboard
        const evts = {
            // onAction: true enables the widget to send action messages back to this node
            onAction: true,
            onInput: function(msg, send) {
                // Handle incoming messages from Node-RED flows
                if (config.passthru) {
                    send(msg);
                }
            },
            beforeSend: function(msg) {
                // Process messages from the UI widget before sending to the flow
                const sendToFlow = (outMsg) => {
                    node.send(outMsg);
                };
                processMessage(msg, sendToFlow);
                // Return null to prevent automatic forwarding since processMessage handles sending
                return null;
            }
        };
        
        // Register with group (NOT ui)
        group.register(node, config, evts);
        
        node.status({fill: "green", shape: "dot", text: "ready"});
        
        node.on('input', async function(msg) {
            // Process messages from Node-RED flows
            const sendToFlow = (outMsg) => {
                node.send(outMsg);
            };
            await processMessage(msg, sendToFlow);
        });
        
        node.on('close', function() {
            node.status({});
        });
    }
    
    RED.nodes.registerType("nmos-matrix-ui", NMOSMatrixUINode);
};
