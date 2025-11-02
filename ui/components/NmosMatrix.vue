<template>
    <div class="nmos-matrix-container">
        <!-- Header Controls -->
        <div class="matrix-header">
            <div class="matrix-controls">
                <input 
                    v-model="senderFilter" 
                    type="text" 
                    placeholder="Filter senders by name..."
                    class="matrix-search"
                />
                <input 
                    v-model="receiverFilter" 
                    type="text" 
                    placeholder="Filter receivers by name..."
                    class="matrix-search"
                />
                <button @click="refreshMatrix" class="matrix-btn matrix-refresh-btn" :disabled="loading">
                    <i class="fa fa-refresh" :class="{'fa-spin': loading}"></i> Refresh
                </button>
                <button @click="saveSnapshot" class="matrix-btn matrix-snapshot-btn" :disabled="loading">
                    <i class="fa fa-save"></i> Save Snapshot
                </button>
                <button @click="clearFilters" class="matrix-btn matrix-clear-btn" v-if="senderFilter || receiverFilter">
                    <i class="fa fa-times"></i> Clear Filters
                </button>
            </div>
            <div class="matrix-status">
                <span class="status-item">
                    <strong>Senders:</strong> {{ filteredSenders.length }} / {{ senders.length }}
                </span>
                <span class="status-item">
                    <strong>Receivers:</strong> {{ filteredReceivers.length }} / {{ receivers.length }}
                </span>
                <span class="status-item">
                    <strong>Active Connections:</strong> {{ connections.length }}
                </span>
                <span v-if="loading" class="loading-indicator">
                    <i class="fa fa-spinner fa-spin"></i> Loading...
                </span>
                <span v-else-if="senders.length > 0 && receivers.length > 0" class="ready-indicator">
                    <i class="fa fa-check-circle"></i> Ready
                </span>
            </div>
        </div>
        
        <!-- Loading overlay for initial load -->
        <div v-if="initialLoading" class="initial-loading-overlay">
            <div class="loading-spinner"></div>
            <p>Loading NMOS routing matrix...</p>
        </div>
        
        <!-- Matrix Grid -->
        <div v-else class="matrix-wrapper">
            <div v-if="senders.length === 0 || receivers.length === 0" class="empty-state">
                <i class="fa fa-exclamation-triangle"></i>
                <p>No senders or receivers found in the NMOS registry.</p>
                <button @click="refreshMatrix" class="matrix-btn matrix-refresh-btn">
                    <i class="fa fa-refresh"></i> Retry
                </button>
            </div>
            <div v-else-if="filteredSenders.length === 0 || filteredReceivers.length === 0" class="empty-state">
                <i class="fa fa-filter"></i>
                <p>No results match your filter criteria.</p>
                <button @click="clearFilters" class="matrix-btn matrix-clear-btn">
                    <i class="fa fa-times"></i> Clear Filters
                </button>
            </div>
            <div v-else class="matrix-grid-container">
                <!-- Top-left corner cell -->
                <div class="matrix-corner">
                    <div class="corner-info">
                        <i class="fa fa-sitemap"></i>
                        <div class="corner-stats">
                            <small>{{ connections.length }}</small>
                            <small>routes</small>
                        </div>
                    </div>
                </div>
                
                <!-- Sender headers (columns) - Display by NAME -->
                <div class="matrix-sender-headers">
                    <div 
                        v-for="sender in filteredSenders" 
                        :key="sender.id"
                        class="matrix-sender-header"
                        :title="`${sender.name}\n${sender.description || ''}\nID: ${sender.id}`"
                    >
                        <span class="sender-label-vertical">{{ sender.name }}</span>
                    </div>
                </div>
                
                <!-- Receiver labels and crosspoints - Display by NAME -->
                <div class="matrix-rows">
                    <div 
                        v-for="receiver in filteredReceivers" 
                        :key="receiver.id"
                        class="matrix-row"
                    >
                        <div 
                            class="matrix-receiver-label" 
                            :title="`${receiver.name}\n${receiver.description || ''}\nID: ${receiver.id}`"
                        >
                            <span class="receiver-name">{{ receiver.name }}</span>
                            <span v-if="getConnectedSenderName(receiver.id)" class="receiver-connection-info">
                                → {{ getConnectedSenderName(receiver.id) }}
                            </span>
                        </div>
                        <div class="matrix-crosspoints">
                            <div 
                                v-for="sender in filteredSenders"
                                :key="`${receiver.id}-${sender.id}`"
                                class="matrix-crosspoint"
                                :class="{ 
                                    'active': isConnected(receiver.id, sender.id),
                                    'hover-highlight': true
                                }"
                                @click="toggleConnection(receiver.id, sender.id, sender.name, receiver.name)"
                                :title="`${sender.name} → ${receiver.name}\nClick to ${isConnected(receiver.id, sender.id) ? 'disconnect' : 'connect'}`"
                            >
                                <div v-if="isConnected(receiver.id, sender.id)" class="crosspoint-indicator">
                                    <i class="fa fa-check"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: 'NmosMatrix',
    inject: ['$socket', 'send'],
    props: {
        id: { type: String, required: true },
        props: { type: Object, default: () => ({}) }
    },
    data() {
        return {
            senders: [],
            receivers: [],
            connections: [],
            senderFilter: '',
            receiverFilter: '',
            loading: false,
            initialLoading: true
        }
    },
    computed: {
        // Filter senders by NAME (label), not UUID
        filteredSenders() {
            if (!this.senderFilter) return this.senders;
            const search = this.senderFilter.toLowerCase();
            return this.senders.filter(s => 
                s.name.toLowerCase().includes(search) ||
                s.description.toLowerCase().includes(search)
            );
        },
        // Filter receivers by NAME (label), not UUID
        filteredReceivers() {
            if (!this.receiverFilter) return this.receivers;
            const search = this.receiverFilter.toLowerCase();
            return this.receivers.filter(r => 
                r.name.toLowerCase().includes(search) ||
                r.description.toLowerCase().includes(search)
            );
        }
    },
    async mounted() {
        await this.loadResources();
        this.initialLoading = false;
        
        // Listen for incoming messages from Node-RED
        if (this.$socket) {
            this.$socket.on(`msg-input:${this.id}`, this.handleMessage);
            this.$socket.on(`widget-load:${this.id}`, this.handleMessage);
        }
    },
    beforeUnmount() {
        if (this.$socket) {
            this.$socket.off(`msg-input:${this.id}`, this.handleMessage);
            this.$socket.off(`widget-load:${this.id}`, this.handleMessage);
        }
    },
    methods: {
        async loadResources() {
            this.loading = true;
            try {
                const registryId = this.props.registry;
                
                if (!registryId) {
                    console.error('No registry configured');
                    return;
                }
                
                // Fetch resources and connections in parallel
                const [resourcesResp, connectionsResp] = await Promise.all([
                    fetch(`/nmos-matrix-ui/resources?registry=${registryId}`),
                    fetch(`/nmos-matrix-ui/connections?registry=${registryId}`)
                ]);
                
                if (!resourcesResp.ok) {
                    throw new Error(`Failed to fetch resources: ${resourcesResp.statusText}`);
                }
                const resourcesData = await resourcesResp.json();
                
                // Sort by name for better UX
                this.senders = (resourcesData.senders || []).sort((a, b) => 
                    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                );
                this.receivers = (resourcesData.receivers || []).sort((a, b) => 
                    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                );
                
                if (!connectionsResp.ok) {
                    throw new Error(`Failed to fetch connections: ${connectionsResp.statusText}`);
                }
                const connectionsData = await connectionsResp.json();
                
                this.connections = connectionsData.connections || [];
                
                console.log(`Matrix loaded: ${this.senders.length} senders, ${this.receivers.length} receivers, ${this.connections.length} active connections`);
                
            } catch (error) {
                console.error('Error loading matrix resources:', error);
            } finally {
                this.loading = false;
            }
        },
        
        async refreshMatrix() {
            await this.loadResources();
        },
        
        clearFilters() {
            this.senderFilter = '';
            this.receiverFilter = '';
        },
        
        isConnected(receiverId, senderId) {
            return this.connections.some(c => 
                c.receiverId === receiverId && c.senderId === senderId
            );
        },
        
        getConnectedSenderName(receiverId) {
            const connection = this.connections.find(c => c.receiverId === receiverId);
            if (!connection) return null;
            
            const sender = this.senders.find(s => s.id === connection.senderId);
            return sender ? sender.name : connection.senderId.substring(0, 8) + '...';
        },
        
        toggleConnection(receiverId, senderId, senderName, receiverName) {
            const isActive = this.isConnected(receiverId, senderId);
            
            // Optimistic UI update
            if (isActive) {
                // Disconnect
                this.connections = this.connections.filter(c => 
                    !(c.receiverId === receiverId && c.senderId === senderId)
                );
            } else {
                // Connect (remove any existing connection for this receiver first)
                this.connections = this.connections.filter(c => c.receiverId !== receiverId);
                this.connections.push({ 
                    receiverId, 
                    senderId,
                    receiverName,
                    senderName
                });
            }
            
            // Send routing action to Node-RED connection node via matrix node
            const action = {
                action: 'route',
                receiverId: receiverId,
                senderId: isActive ? null : senderId,
                operation: isActive ? 'disconnect' : 'activate',
                senderName: senderName,
                receiverName: receiverName
            };
            
            console.log(`Routing: ${senderName} → ${receiverName} [${action.operation}]`);
            this.sendMessage({ payload: action });
            
            // Refresh after a delay to get accurate state
            setTimeout(() => {
                this.loadResources();
            }, 2000);
        },
        
        // Save current routing state as JSON snapshot
        saveSnapshot() {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            
            const snapshot = {
                metadata: {
                    timestamp: new Date().toISOString(),
                    description: 'NMOS Matrix Routing Snapshot',
                    totalSenders: this.senders.length,
                    totalReceivers: this.receivers.length,
                    activeConnections: this.connections.length
                },
                senders: this.senders.map(s => ({
                    id: s.id,
                    name: s.name,
                    label: s.label,
                    description: s.description,
                    flow_id: s.flow_id
                })),
                receivers: this.receivers.map(r => ({
                    id: r.id,
                    name: r.name,
                    label: r.label,
                    description: r.description
                })),
                connections: this.connections.map(c => {
                    const sender = this.senders.find(s => s.id === c.senderId);
                    const receiver = this.receivers.find(r => r.id === c.receiverId);
                    return {
                        receiverId: c.receiverId,
                        receiverName: receiver ? receiver.name : c.receiverId,
                        senderId: c.senderId,
                        senderName: sender ? sender.name : c.senderId
                    };
                })
            };
            
            // Create downloadable JSON file
            const jsonString = JSON.stringify(snapshot, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `nmos-routing-snapshot-${timestamp}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            console.log('Snapshot saved:', snapshot);
            
            // Also send snapshot to Node-RED
            this.sendMessage({ 
                payload: {
                    action: 'snapshot',
                    snapshot: snapshot
                }
            });
        },
        
        handleMessage(msg) {
            // Handle incoming messages from Node-RED
            if (msg.payload && msg.payload.action === 'refresh') {
                this.loadResources();
            }
        },
        
        sendMessage(msg) {
            // Send message back to Node-RED
            if (this.send) {
                this.send(msg);
            }
        }
    }
}
</script>

<style scoped>
.nmos-matrix-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #1a1a1a;
    color: #e0e0e0;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    min-height: 500px;
    position: relative;
    border-radius: 8px;
    overflow: hidden;
}

.initial-loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(26, 26, 26, 0.98);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.loading-spinner {
    width: 60px;
    height: 60px;
    border: 5px solid #333;
    border-top: 5px solid #3FADB5;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 20px;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.initial-loading-overlay p {
    color: #3FADB5;
    font-size: 18px;
    font-weight: 500;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #999;
    gap: 20px;
    padding: 40px;
}

.empty-state i {
    font-size: 64px;
    color: #666;
}

.empty-state p {
    font-size: 18px;
    margin: 0;
    text-align: center;
}

.matrix-header {
    padding: 15px;
    background: linear-gradient(135deg, #252525 0%, #2a2a2a 100%);
    border-bottom: 2px solid #3FADB5;
    flex-shrink: 0;
}

.matrix-controls {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
    align-items: center;
}

.matrix-search {
    flex: 1;
    min-width: 180px;
    padding: 10px 12px;
    background: #333;
    border: 1px solid #555;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 14px;
    transition: all 0.3s;
}

.matrix-search:focus {
    outline: none;
    border-color: #3FADB5;
    background: #3a3a3a;
    box-shadow: 0 0 0 3px rgba(63, 173, 181, 0.1);
}

.matrix-btn {
    padding: 10px 18px;
    border: none;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.3s;
    display: flex;
    align-items: center;
    gap: 6px;
}

.matrix-refresh-btn {
    background: linear-gradient(135deg, #3FADB5 0%, #2d8a91 100%);
}

.matrix-refresh-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #2d8a91 0%, #236a70 100%);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(63, 173, 181, 0.3);
}

.matrix-snapshot-btn {
    background: linear-gradient(135deg, #4CAF50 0%, #388E3C 100%);
}

.matrix-snapshot-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #388E3C 0%, #2C6B2F 100%);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(76, 175, 80, 0.3);
}

.matrix-clear-btn {
    background: linear-gradient(135deg, #FF6B6B 0%, #C92A2A 100%);
}

.matrix-clear-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #C92A2A 0%, #A61E1E 100%);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(255, 107, 107, 0.3);
}

.matrix-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.matrix-status {
    display: flex;
    gap: 20px;
    font-size: 13px;
    color: #999;
    flex-wrap: wrap;
    align-items: center;
}

.status-item {
    display: flex;
    align-items: center;
    gap: 5px;
}

.status-item strong {
    color: #3FADB5;
}

.loading-indicator {
    color: #3FADB5;
    font-weight: 600;
}

.ready-indicator {
    color: #4CAF50;
    font-weight: 600;
}

.matrix-wrapper {
    flex: 1;
    overflow: auto;
    background: #1a1a1a;
}

.matrix-grid-container {
    display: grid;
    grid-template-columns: 200px 1fr;
    grid-template-rows: 100px 1fr;
    min-width: min-content;
}

.matrix-corner {
    background: linear-gradient(135deg, #2a2a2a 0%, #252525 100%);
    border-right: 2px solid #444;
    border-bottom: 2px solid #444;
    position: sticky;
    top: 0;
    left: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
}

.corner-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #3FADB5;
}

.corner-info i {
    font-size: 24px;
}

.corner-stats {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.corner-stats small {
    font-size: 11px;
    font-weight: 600;
}

.matrix-sender-headers {
    display: flex;
    background: linear-gradient(135deg, #2a2a2a 0%, #252525 100%);
    border-bottom: 2px solid #444;
    position: sticky;
    top: 0;
    z-index: 2;
}

.matrix-sender-header {
    width: 45px;
    min-width: 45px;
    height: 100px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 8px 0;
    border-right: 1px solid #333;
    background: #252525;
    transition: background 0.2s;
}

.matrix-sender-header:hover {
    background: #2d2d2d;
}

.sender-label-vertical {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-height: 85px;
    color: #e0e0e0;
}

.matrix-rows {
    grid-column: 1 / -1;
    display: contents;
}

.matrix-row {
    display: contents;
}

.matrix-receiver-label {
    background: linear-gradient(90deg, #2a2a2a 0%, #252525 100%);
    padding: 12px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    font-size: 13px;
    border-right: 2px solid #444;
    border-bottom: 1px solid #333;
    position: sticky;
    left: 0;
    z-index: 1;
    transition: background 0.2s;
}

.matrix-receiver-label:hover {
    background: linear-gradient(90deg, #2d2d2d 0%, #282828 100%);
}

.receiver-name {
    font-weight: 600;
    color: #e0e0e0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.receiver-connection-info {
    font-size: 11px;
    color: #3FADB5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.matrix-crosspoints {
    display: flex;
    border-bottom: 1px solid #333;
}

.matrix-crosspoint {
    width: 45px;
    min-width: 45px;
    height: 45px;
    background: #2a2a2a;
    border-right: 1px solid #333;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}

.matrix-crosspoint.hover-highlight:hover {
    background: #3a3a3a;
    box-shadow: inset 0 0 10px rgba(63, 173, 181, 0.3);
}

.matrix-crosspoint.active {
    background: linear-gradient(135deg, #3FADB5 0%, #2d8a91 100%);
    box-shadow: 0 0 10px rgba(63, 173, 181, 0.5);
}

.matrix-crosspoint.active:hover {
    background: linear-gradient(135deg, #4FBDC5 0%, #3D9AA1 100%);
    box-shadow: 0 0 15px rgba(63, 173, 181, 0.7);
}

.crosspoint-indicator {
    color: white;
    font-size: 16px;
    font-weight: bold;
}

/* Scrollbar styling */
.matrix-wrapper::-webkit-scrollbar {
    width: 12px;
    height: 12px;
}

.matrix-wrapper::-webkit-scrollbar-track {
    background: #1a1a1a;
}

.matrix-wrapper::-webkit-scrollbar-thumb {
    background: linear-gradient(135deg, #3FADB5 0%, #2d8a91 100%);
    border-radius: 6px;
}

.matrix-wrapper::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(135deg, #4FBDC5 0%, #3D9AA1 100%);
}

.matrix-wrapper::-webkit-scrollbar-corner {
    background: #1a1a1a;
}
</style>