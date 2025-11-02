<template>
    <div class="nmos-matrix-container">
        <!-- Header Controls -->
        <div class="matrix-header">
            <div class="matrix-controls">
                <input 
                    v-model="senderSearch" 
                    type="text" 
                    placeholder="Search senders..."
                    class="matrix-search"
                />
                <input 
                    v-model="receiverSearch" 
                    type="text" 
                    placeholder="Search receivers..."
                    class="matrix-search"
                />
                <button @click="refreshMatrix" class="matrix-refresh-btn" :disabled="loading">
                    <i class="fa fa-refresh" :class="{'fa-spin': loading}"></i> Refresh
                </button>
                <label class="auto-refresh-label">
                    <input type="checkbox" v-model="autoRefresh" @change="toggleAutoRefresh" />
                    Auto-refresh (30s)
                </label>
            </div>
            <div class="matrix-status">
                <span>Senders: {{ filteredSenders.length }} / {{ senders.length }}</span>
                <span>Receivers: {{ filteredReceivers.length }} / {{ receivers.length }}</span>
                <span v-if="loading" class="loading-indicator">Loading...</span>
                <span v-else-if="senders.length > 0 && receivers.length > 0" class="ready-indicator">Ready</span>
                <span v-else class="warning-indicator">No resources found</span>
            </div>
        </div>
        
        <!-- Loading overlay for initial load -->
        <div v-if="initialLoading" class="initial-loading-overlay">
            <div class="loading-spinner"></div>
            <p>Loading senders and receivers from NMOS registry...</p>
        </div>
        
        <!-- Matrix Grid -->
        <div v-else class="matrix-wrapper">
            <div v-if="senders.length === 0 || receivers.length === 0" class="empty-state">
                <i class="fa fa-exclamation-triangle"></i>
                <p>No senders or receivers found in the registry.</p>
                <button @click="refreshMatrix" class="matrix-refresh-btn">
                    <i class="fa fa-refresh"></i> Retry
                </button>
            </div>
            <div v-else class="matrix-grid-container">
                <!-- Top-left corner cell -->
                <div class="matrix-corner">
                    <div class="corner-info">
                        <small>{{ connections.length }} active</small>
                    </div>
                </div>
                
                <!-- Sender headers (columns) -->
                <div class="matrix-sender-headers">
                    <div 
                        v-for="sender in filteredSenders" 
                        :key="sender.id"
                        class="matrix-sender-header"
                        :title="`${sender.label}\nID: ${sender.id}`"
                    >
                        <span class="sender-label-vertical">{{ sender.label }}</span>
                    </div>
                </div>
                
                <!-- Receiver labels and crosspoints -->
                <div class="matrix-rows">
                    <div 
                        v-for="receiver in filteredReceivers" 
                        :key="receiver.id"
                        class="matrix-row"
                    >
                        <div class="matrix-receiver-label" :title="`${receiver.label}\nID: ${receiver.id}`">
                            {{ receiver.label }}
                        </div>
                        <div class="matrix-crosspoints">
                            <div 
                                v-for="sender in filteredSenders"
                                :key="`${receiver.id}-${sender.id}`"
                                class="matrix-crosspoint"
                                :class="{ 'active': isConnected(receiver.id, sender.id) }"
                                @click="toggleConnection(receiver.id, sender.id)"
                                :title="`${sender.label} → ${receiver.label}\nClick to ${isConnected(receiver.id, sender.id) ? 'disconnect' : 'connect'}`"
                            ></div>
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
            senderSearch: '',
            receiverSearch: '',
            loading: false,
            initialLoading: true,
            autoRefresh: false,
            refreshInterval: null
        }
    },
    computed: {
        filteredSenders() {
            if (!this.senderSearch) return this.senders;
            const search = this.senderSearch.toLowerCase();
            return this.senders.filter(s => 
                s.label.toLowerCase().includes(search) ||
                s.id.toLowerCase().includes(search)
            );
        },
        filteredReceivers() {
            if (!this.receiverSearch) return this.receivers;
            const search = this.receiverSearch.toLowerCase();
            return this.receivers.filter(r => 
                r.label.toLowerCase().includes(search) ||
                r.id.toLowerCase().includes(search)
            );
        }
    },
    async mounted() {
        // Automatically load resources on mount for instant use
        await this.loadResources();
        this.initialLoading = false;
        
        // Listen for incoming messages from Node-RED (Dashboard 2.0 pattern)
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
        
        // Clear auto-refresh interval
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
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
                
                // Fetch resources and connections in parallel for faster loading
                const [resourcesResp, connectionsResp] = await Promise.all([
                    fetch(`/nmos-matrix-ui/resources?registry=${registryId}`),
                    fetch(`/nmos-matrix-ui/connections?registry=${registryId}`)
                ]);
                
                if (!resourcesResp.ok) {
                    throw new Error(`Failed to fetch resources: ${resourcesResp.statusText}`);
                }
                const resourcesData = await resourcesResp.json();
                
                // Sort senders and receivers by label for better UX
                this.senders = (resourcesData.senders || []).sort((a, b) => 
                    a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
                );
                this.receivers = (resourcesData.receivers || []).sort((a, b) => 
                    a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
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
        toggleAutoRefresh() {
            if (this.autoRefresh) {
                // Start auto-refresh every 30 seconds
                this.refreshInterval = setInterval(() => {
                    this.loadResources();
                }, 30000);
            } else {
                // Stop auto-refresh
                if (this.refreshInterval) {
                    clearInterval(this.refreshInterval);
                    this.refreshInterval = null;
                }
            }
        },
        isConnected(receiverId, senderId) {
            return this.connections.some(c => 
                c.receiverId === receiverId && c.senderId === senderId
            );
        },
        toggleConnection(receiverId, senderId) {
            const isActive = this.isConnected(receiverId, senderId);
            
            // Optimistic update
            if (isActive) {
                // Disconnect
                this.connections = this.connections.filter(c => 
                    !(c.receiverId === receiverId && c.senderId === senderId)
                );
            } else {
                // Connect (remove any existing connection for this receiver first)
                this.connections = this.connections.filter(c => c.receiverId !== receiverId);
                this.connections.push({ receiverId, senderId });
            }
            
            // Send routing action to Node-RED
            const action = {
                action: 'route',
                receiverId: receiverId,
                senderId: isActive ? null : senderId,
                operation: isActive ? 'disconnect' : 'activate'
            };
            
            this.sendMessage({ payload: action });
            
            // Refresh after a delay to get accurate state from IS-05
            setTimeout(() => {
                this.loadResources();
            }, 2000);
        },
        handleMessage(msg) {
            // Handle incoming messages from Node-RED
            if (msg.payload && msg.payload.action === 'refresh') {
                this.loadResources();
            }
        },
        sendMessage(msg) {
            // Send message back to Node-RED using Dashboard 2.0 API
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
    font-family: Arial, sans-serif;
    min-height: 400px;
    position: relative;
}

.initial-loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(26, 26, 26, 0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.loading-spinner {
    width: 50px;
    height: 50px;
    border: 4px solid #333;
    border-top: 4px solid #3FADB5;
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
    font-size: 16px;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #999;
    gap: 20px;
}

.empty-state i {
    font-size: 48px;
    color: #666;
}

.empty-state p {
    font-size: 16px;
    margin: 0;
}

.matrix-header {
    padding: 10px;
    background: #252525;
    border-bottom: 1px solid #3FADB5;
    flex-shrink: 0;
}

.matrix-controls {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
    flex-wrap: wrap;
    align-items: center;
}

.matrix-search {
    flex: 1;
    min-width: 150px;
    padding: 8px;
    background: #333;
    border: 1px solid #555;
    border-radius: 4px;
    color: #e0e0e0;
    font-size: 14px;
}

.matrix-search:focus {
    outline: none;
    border-color: #3FADB5;
}

.matrix-refresh-btn {
    padding: 8px 16px;
    background: #3FADB5;
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    transition: background-color 0.2s;
}

.matrix-refresh-btn:hover:not(:disabled) {
    background: #2d8a91;
}

.matrix-refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.auto-refresh-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    color: #ccc;
    cursor: pointer;
    white-space: nowrap;
}

.auto-refresh-label input[type="checkbox"] {
    cursor: pointer;
}

.matrix-status {
    display: flex;
    gap: 20px;
    font-size: 12px;
    color: #999;
    flex-wrap: wrap;
}

.loading-indicator {
    color: #3FADB5;
    font-weight: bold;
}

.ready-indicator {
    color: #4CAF50;
    font-weight: bold;
}

.warning-indicator {
    color: #ff9800;
    font-weight: bold;
}

.matrix-wrapper {
    flex: 1;
    overflow: auto;
    background: #1a1a1a;
}

.matrix-grid-container {
    display: grid;
    grid-template-columns: 150px 1fr;
    grid-template-rows: 80px 1fr;
    min-width: min-content;
}

.matrix-corner {
    background: #252525;
    border-right: 1px solid #444;
    border-bottom: 1px solid #444;
    position: sticky;
    top: 0;
    left: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
}

.corner-info {
    color: #3FADB5;
    font-size: 11px;
    font-weight: bold;
    text-align: center;
}

.matrix-sender-headers {
    display: flex;
    background: #252525;
    border-bottom: 1px solid #444;
    position: sticky;
    top: 0;
    z-index: 2;
}

.matrix-sender-header {
    width: 40px;
    min-width: 40px;
    height: 80px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 5px 0;
    border-right: 1px solid #333;
    background: #252525;
}

.sender-label-vertical {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-height: 70px;
}

.matrix-rows {
    grid-column: 1 / -1;
    display: contents;
}

.matrix-row {
    display: contents;
}

.matrix-receiver-label {
    background: #252525;
    padding: 10px;
    display: flex;
    align-items: center;
    font-size: 12px;
    border-right: 1px solid #444;
    border-bottom: 1px solid #333;
    position: sticky;
    left: 0;
    z-index: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.matrix-crosspoints {
    display: flex;
    border-bottom: 1px solid #333;
}

.matrix-crosspoint {
    width: 40px;
    min-width: 40px;
    height: 40px;
    background: #2a2a2a;
    border-right: 1px solid #333;
    cursor: pointer;
    transition: background-color 0.2s;
}

.matrix-crosspoint:hover {
    background: #3a3a3a;
}

.matrix-crosspoint.active {
    background: #3FADB5;
}

.matrix-crosspoint.active:hover {
    background: #2d8a91;
}

/* Scrollbar styling for dark theme */
.matrix-wrapper::-webkit-scrollbar {
    width: 10px;
    height: 10px;
}

.matrix-wrapper::-webkit-scrollbar-track {
    background: #1a1a1a;
}

.matrix-wrapper::-webkit-scrollbar-thumb {
    background: #3FADB5;
    border-radius: 5px;
}

.matrix-wrapper::-webkit-scrollbar-thumb:hover {
    background: #2d8a91;
}
</style>
