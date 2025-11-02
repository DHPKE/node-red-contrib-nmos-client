const axios = require('axios');

module.exports = function(RED) {
    function NMOSMatrixNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Get registry configuration
        this.registry = RED.nodes.getNode(config.registry);
        this.refreshInterval = parseInt(config.refreshInterval) || 5000;
        this.autoRefresh = config.autoRefresh !== false;
        this.compactView = config.compactView || false;
        this.showLabels = config.showLabels !== false;
        this.colorScheme = config.colorScheme || 'default';
        this.connectionTimeout = parseInt(config.connectionTimeout) || 30000;
        this.retryAttempts = parseInt(config.retryAttempts) || 3;
        
        // Internal state
        this.senders = [];
        this.receivers = [];
        this.routes = {};
        this.pollTimer = null;
        this.pendingOperations = new Map();
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        node.status({fill: "yellow", shape: "ring", text: "initializing"});
        
        // Fetch senders from registry
        const fetchSenders = async () => {
            try {
                const url = `${node.registry.getQueryApiUrl()}/senders`;
                const response = await axios.get(url, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000,
                    params: { 'paging.limit': 1000 }
                });
                
                node.senders = response.data.map(s => ({
                    id: s.id,
                    label: s.label || s.id,
                    description: s.description || '',
                    flow_id: s.flow_id,
                    device_id: s.device_id,
                    manifest_href: s.manifest_href,
                    transport: s.transport
                })).sort((a, b) => a.label.localeCompare(b.label));
                
                return node.senders;
            } catch (error) {
                node.error(`Failed to fetch senders: ${error.message}`);
                throw error;
            }
        };
        
        // Fetch receivers from registry
        const fetchReceivers = async () => {
            try {
                const url = `${node.registry.getQueryApiUrl()}/receivers`;
                const response = await axios.get(url, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 10000,
                    params: { 'paging.limit': 1000 }
                });
                
                node.receivers = response.data.map(r => ({
                    id: r.id,
                    label: r.label || r.id,
                    description: r.description || '',
                    device_id: r.device_id,
                    subscription: r.subscription || {},
                    transport: r.transport,
                    caps: r.caps || {}
                })).sort((a, b) => a.label.localeCompare(b.label));
                
                // Extract active connections from subscriptions
                extractConnections();
                
                return node.receivers;
            } catch (error) {
                node.error(`Failed to fetch receivers: ${error.message}`);
                throw error;
            }
        };
        
        // Extract connections from receiver subscriptions
        const extractConnections = () => {
            node.routes = {};
            node.receivers.forEach(receiver => {
                if (receiver.subscription && receiver.subscription.sender_id) {
                    node.routes[receiver.id] = receiver.subscription.sender_id;
                }
            });
        };
        
        // Refresh endpoints
        const refreshEndpoints = async () => {
            try {
                node.status({fill: "blue", shape: "dot", text: "refreshing"});
                await Promise.all([fetchSenders(), fetchReceivers()]);
                node.status({fill: "green", shape: "dot", text: `${node.senders.length}S/${node.receivers.length}R`});
                
                // Broadcast update to all connected clients
                broadcastUpdate();
                return true;
            } catch (error) {
                node.status({fill: "red", shape: "ring", text: "error"});
                return false;
            }
        };
        
        // Get connection API for a receiver
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
                
                const connectionControl = device.controls.find(c => 
                    c.type === "urn:x-nmos:control:sr-ctrl/v1.1" ||
                    c.type === "urn:x-nmos:control:sr-ctrl/v1.0"
                );
                
                if (!connectionControl) {
                    throw new Error("Device has no connection control");
                }
                
                return connectionControl.href;
            } catch (error) {
                throw new Error(`Failed to get connection API: ${error.message}`);
            }
        };
        
        // Create or remove route
        const executeRoute = async (senderId, receiverId, operation = 'activate') => {
            const operationId = `${receiverId}-${Date.now()}`;
            node.pendingOperations.set(operationId, {senderId, receiverId, operation});
            
            try {
                node.status({fill: "yellow", shape: "dot", text: "routing..."});
                
                const connectionApiUrl = await getConnectionAPI(receiverId);
                
                // Stage the connection
                const stageUrl = `${connectionApiUrl}/single/receivers/${receiverId}/staged`;
                const patchData = {
                    sender_id: operation === 'disconnect' ? null : senderId,
                    master_enable: operation !== 'disconnect',
                    activation: {
                        mode: "activate_immediate"
                    }
                };
                
                await axios.patch(stageUrl, patchData, {
                    headers: {
                        ...node.registry.getAuthHeaders(),
                        'Content-Type': 'application/json'
                    },
                    timeout: node.connectionTimeout
                });
                
                // Update local state
                if (operation === 'disconnect') {
                    delete node.routes[receiverId];
                } else {
                    node.routes[receiverId] = senderId;
                }
                
                node.pendingOperations.delete(operationId);
                node.status({fill: "green", shape: "dot", text: `${node.senders.length}S/${node.receivers.length}R`});
                
                // Send output message
                node.send({
                    payload: {
                        event: 'route_changed',
                        sender_id: senderId,
                        receiver_id: receiverId,
                        status: operation === 'disconnect' ? 'disconnected' : 'connected'
                    }
                });
                
                // Broadcast update to clients
                broadcastUpdate();
                
                return {success: true, operation, senderId, receiverId};
            } catch (error) {
                node.pendingOperations.delete(operationId);
                node.status({fill: "red", shape: "ring", text: "route failed"});
                node.error(`Routing failed: ${error.message}`);
                
                // Send error output
                node.send({
                    payload: {
                        event: 'error',
                        message: `Routing failed: ${error.message}`,
                        sender_id: senderId,
                        receiver_id: receiverId
                    }
                });
                
                throw error;
            }
        };
        
        // Save snapshot
        const saveSnapshot = (name, description) => {
            const snapshot = {
                version: "1.0",
                timestamp: new Date().toISOString(),
                name: name || "Unnamed Snapshot",
                description: description || "",
                registry: node.registry.getQueryApiUrl(),
                routes: []
            };
            
            // Build routes array
            Object.keys(node.routes).forEach(receiverId => {
                const senderId = node.routes[receiverId];
                const sender = node.senders.find(s => s.id === senderId);
                const receiver = node.receivers.find(r => r.id === receiverId);
                
                if (sender && receiver) {
                    snapshot.routes.push({
                        sender_id: senderId,
                        sender_label: sender.label,
                        receiver_id: receiverId,
                        receiver_label: receiver.label,
                        transport_params: {
                            type: sender.transport
                        },
                        connected_at: new Date().toISOString()
                    });
                }
            });
            
            // Store in context
            node.context().set('lastSnapshot', snapshot);
            
            // Send output message
            node.send({
                payload: {
                    event: 'snapshot_saved',
                    snapshot: snapshot,
                    timestamp: snapshot.timestamp
                }
            });
            
            return snapshot;
        };
        
        // Load snapshot
        const loadSnapshot = async (snapshot) => {
            try {
                if (!snapshot || !snapshot.routes || !Array.isArray(snapshot.routes)) {
                    throw new Error("Invalid snapshot format");
                }
                
                // Validate routes
                const validRoutes = [];
                const invalidRoutes = [];
                
                snapshot.routes.forEach(route => {
                    const sender = node.senders.find(s => s.id === route.sender_id);
                    const receiver = node.receivers.find(r => r.id === route.receiver_id);
                    
                    if (sender && receiver) {
                        validRoutes.push(route);
                    } else {
                        invalidRoutes.push({
                            ...route,
                            reason: !sender ? 'Sender not found' : 'Receiver not found'
                        });
                    }
                });
                
                // Apply valid routes
                const results = [];
                for (const route of validRoutes) {
                    try {
                        await executeRoute(route.sender_id, route.receiver_id, 'activate');
                        results.push({success: true, route});
                    } catch (error) {
                        results.push({success: false, route, error: error.message});
                    }
                }
                
                return {
                    success: true,
                    validRoutes: validRoutes.length,
                    invalidRoutes: invalidRoutes.length,
                    applied: results.filter(r => r.success).length,
                    failed: results.filter(r => !r.success).length,
                    invalidRoutes
                };
            } catch (error) {
                node.error(`Failed to load snapshot: ${error.message}`);
                throw error;
            }
        };
        
        // Broadcast update to connected clients (for future dashboard integration)
        const broadcastUpdate = () => {
            const data = {
                senders: node.senders,
                receivers: node.receivers,
                routes: node.routes,
                timestamp: new Date().toISOString()
            };
            
            // Store in context for HTTP endpoints to access
            node.context().set('matrixData', data);
        };
        
        // Handle input messages
        node.on('input', async (msg) => {
            try {
                const action = msg.payload?.action || msg.action;
                
                switch(action) {
                    case 'refresh':
                        await refreshEndpoints();
                        msg.payload = {
                            event: 'refreshed',
                            senders: node.senders.length,
                            receivers: node.receivers.length
                        };
                        node.send(msg);
                        break;
                        
                    case 'route':
                        if (!msg.payload.sender_id || !msg.payload.receiver_id) {
                            throw new Error("sender_id and receiver_id required for route action");
                        }
                        await executeRoute(msg.payload.sender_id, msg.payload.receiver_id, 'activate');
                        break;
                        
                    case 'disconnect':
                        if (!msg.payload.receiver_id) {
                            throw new Error("receiver_id required for disconnect action");
                        }
                        await executeRoute(null, msg.payload.receiver_id, 'disconnect');
                        break;
                        
                    case 'save_snapshot':
                        const snapshot = saveSnapshot(msg.payload.name, msg.payload.description);
                        msg.payload = {
                            event: 'snapshot_saved',
                            snapshot
                        };
                        node.send(msg);
                        break;
                        
                    case 'load_snapshot':
                        if (!msg.payload.snapshot) {
                            throw new Error("snapshot required for load_snapshot action");
                        }
                        const result = await loadSnapshot(msg.payload.snapshot);
                        msg.payload = {
                            event: 'snapshot_loaded',
                            result
                        };
                        node.send(msg);
                        break;
                        
                    case 'get_state':
                        msg.payload = {
                            event: 'state',
                            senders: node.senders,
                            receivers: node.receivers,
                            routes: node.routes
                        };
                        node.send(msg);
                        break;
                        
                    default:
                        node.warn(`Unknown action: ${action}`);
                }
            } catch (error) {
                node.error(`Error handling input: ${error.message}`, msg);
                node.send({
                    payload: {
                        event: 'error',
                        message: error.message
                    }
                });
            }
        });
        
        // Start auto-refresh if enabled
        if (node.autoRefresh) {
            refreshEndpoints(); // Initial refresh
            node.pollTimer = setInterval(() => {
                refreshEndpoints();
            }, node.refreshInterval);
        }
        
        // Cleanup on close
        node.on('close', (done) => {
            if (node.pollTimer) {
                clearInterval(node.pollTimer);
                node.pollTimer = null;
            }
            done();
        });
    }
    
    RED.nodes.registerType("nmos-matrix", NMOSMatrixNode);
};
