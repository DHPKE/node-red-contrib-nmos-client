<template>
  <div class="nmos-matrix-dante" :class="{'compact-view': compactView}">
    <!-- Dante-Style Toolbar -->
    <div class="dante-toolbar">
      <div class="toolbar-left">
        <h2 class="matrix-title">{{ matrixName || 'NMOS Routing Matrix' }}</h2>
      </div>
      
      <div class="toolbar-center">
        <div class="view-switcher">
          <button 
            :class="['view-btn', {active: currentView === 'grid'}]" 
            @click="currentView = 'grid'"
            title="Grid View"
          >
            <span class="icon">⊞</span> Grid
          </button>
          <button 
            :class="['view-btn', {active: currentView === 'list'}]" 
            @click="currentView = 'list'"
            title="List View"
          >
            <span class="icon">☰</span> List
          </button>
        </div>
        
        <div class="device-selector" v-if="devices.length > 0">
          <label>Device:</label>
          <select v-model="selectedDevice" @change="loadDeviceMatrix">
            <option value="">All Devices</option>
            <option v-for="device in devices" :key="device.id" :value="device.id">
              {{ device.name }}
            </option>
          </select>
        </div>
      </div>
      
      <div class="toolbar-right">
        <button @click="refreshEndpoints" class="toolbar-btn" :disabled="loading" title="Refresh">
          <span v-if="!loading">🔄</span>
          <span v-else class="spinner-small"></span>
        </button>
        <button @click="toggleRouteLock" :class="['toolbar-btn', {active: routesLocked}]" :title="routesLocked ? 'Unlock Routes' : 'Lock Routes'">
          <span>{{ routesLocked ? '🔒' : '🔓' }}</span>
        </button>
        <button @click="showClearDialog = true" class="toolbar-btn" title="Clear All Routes">
          <span>🗑️</span>
        </button>
        <button @click="showSnapshotMenu = !showSnapshotMenu" class="toolbar-btn" title="Snapshots">
          <span>💾</span>
        </button>
      </div>
    </div>
    
    <!-- Status Panel -->
    <div class="status-panel">
      <div class="status-card">
        <div class="status-label">Devices</div>
        <div class="status-value">{{ devices.length }}</div>
      </div>
      <div class="status-card">
        <div class="status-label">TX Channels</div>
        <div class="status-value">{{ filteredSenders.length }}</div>
      </div>
      <div class="status-card">
        <div class="status-label">RX Channels</div>
        <div class="status-value">{{ filteredReceivers.length }}</div>
      </div>
      <div class="status-card">
        <div class="status-label">Active Routes</div>
        <div class="status-value">{{ activeRoutesCount }}</div>
      </div>
      <div class="status-card" v-if="showMeters">
        <div class="status-label">Avg Latency</div>
        <div class="status-value">{{ avgLatency }}ms</div>
      </div>
    </div>
    
    <!-- Grid View -->
    <div v-if="currentView === 'grid'" class="matrix-view">
      <div v-if="filteredSenders.length > 0 && filteredReceivers.length > 0" class="matrix-grid-wrapper">
        <table class="dante-matrix-table">
          <thead>
            <tr>
              <th class="corner-cell">TX / RX</th>
              <th 
                v-for="sender in filteredSenders" 
                :key="sender.id"
                :class="['sender-header', {highlighted: highlightedSender === sender.id}]"
                :title="getSenderTooltip(sender)"
                @mouseenter="highlightedSender = sender.id"
                @mouseleave="highlightedSender = null"
              >
                <div class="header-label">{{ sender.label }}</div>
                <div class="header-device" v-if="sender.device_name">{{ sender.device_name }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="receiver in filteredReceivers" :key="receiver.id">
              <td 
                :class="['receiver-label', {highlighted: highlightedReceiver === receiver.id}]"
                :title="getReceiverTooltip(receiver)"
                @mouseenter="highlightedReceiver = receiver.id"
                @mouseleave="highlightedReceiver = null"
              >
                <div class="label-text">{{ receiver.label }}</div>
                <div class="label-device" v-if="receiver.device_name">{{ receiver.device_name }}</div>
              </td>
              <td 
                v-for="sender in filteredSenders" 
                :key="sender.id"
                :class="getCrosspointClass(sender.id, receiver.id)"
                @click="handleCrosspointClick(sender.id, receiver.id)"
                :title="getCellTooltip(sender, receiver)"
              >
                <span class="crosspoint-indicator">
                  {{ getCellIcon(sender.id, receiver.id) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <div v-else class="empty-state">
        <div class="empty-icon">📡</div>
        <h3>No Endpoints Available</h3>
        <p>{{ emptyStateMessage }}</p>
      </div>
    </div>
    
    <!-- List View -->
    <div v-if="currentView === 'list'" class="list-view">
      <div class="list-search">
        <input 
          v-model="listSearch" 
          type="text"
          placeholder="Search receivers..." 
          class="search-input"
        />
      </div>
      
      <div class="receiver-list">
        <div 
          v-for="receiver in filteredReceiversList" 
          :key="receiver.id"
          class="receiver-item"
        >
          <div class="receiver-info">
            <div class="receiver-icon">📻</div>
            <div class="receiver-details">
              <div class="receiver-name">{{ receiver.label }}</div>
              <div class="receiver-device" v-if="receiver.device_name">{{ receiver.device_name }}</div>
            </div>
          </div>
          
          <div class="receiver-routing">
            <select 
              :value="routes[receiver.id] || ''"
              @change="routeFromList($event, receiver.id)"
              :disabled="routesLocked"
              class="sender-dropdown"
            >
              <option value="">-- Not Connected --</option>
              <option 
                v-for="sender in filteredSenders" 
                :key="sender.id" 
                :value="sender.id"
              >
                {{ sender.label }}
              </option>
            </select>
            
            <span class="status-badge" :class="getStatusBadgeClass(receiver.id)">
              {{ getStatusBadgeText(receiver.id) }}
            </span>
            
            <button 
              v-if="routes[receiver.id]"
              @click="disconnectReceiver(receiver.id)"
              :disabled="routesLocked"
              class="disconnect-btn"
              title="Disconnect"
            >
              ✖
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Connection Error Banner -->
    <div v-if="connectionError && !loading" class="error-banner">
      <div class="error-icon">⚠️</div>
      <div class="error-content">
        <h3>{{ connectionError.message }}</h3>
        <p v-if="connectionError.details">{{ connectionError.details }}</p>
        <ul v-if="connectionError.suggestions && connectionError.suggestions.length > 0" class="suggestions-list">
          <li v-for="(suggestion, idx) in connectionError.suggestions" :key="idx">
            {{ suggestion }}
          </li>
        </ul>
        <button @click="retryConnection" class="btn-primary">
          🔄 Retry Connection
        </button>
      </div>
    </div>
    
    <!-- Confirmation Dialog -->
    <div v-if="showConfirmDialog" class="modal-overlay" @click="cancelRoute">
      <div class="modal-dialog" @click.stop>
        <div class="modal-header">
          <h3>Confirm Route Change</h3>
        </div>
        <div class="modal-body">
          <p v-if="pendingRoute.action === 'connect'">
            <strong>Connect:</strong><br>
            {{ getSenderLabel(pendingRoute.senderId) }} → {{ getReceiverLabel(pendingRoute.receiverId) }}
          </p>
          <p v-else-if="pendingRoute.action === 'disconnect'">
            <strong>Disconnect:</strong><br>
            {{ getReceiverLabel(pendingRoute.receiverId) }}
          </p>
          <p v-else-if="pendingRoute.action === 'change'">
            <strong>Change Route:</strong><br>
            From: {{ getSenderLabel(routes[pendingRoute.receiverId]) }} → {{ getReceiverLabel(pendingRoute.receiverId) }}<br>
            To: {{ getSenderLabel(pendingRoute.senderId) }} → {{ getReceiverLabel(pendingRoute.receiverId) }}
          </p>
        </div>
        <div class="modal-footer">
          <button @click="cancelRoute" class="btn-secondary">Cancel</button>
          <button @click="confirmRoute" class="btn-primary">Confirm</button>
        </div>
      </div>
    </div>
    
    <!-- Clear All Dialog -->
    <div v-if="showClearDialog" class="modal-overlay" @click="showClearDialog = false">
      <div class="modal-dialog" @click.stop>
        <div class="modal-header">
          <h3>Clear All Routes</h3>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to disconnect all active routes?</p>
          <p><strong>{{ activeRoutesCount }}</strong> routes will be cleared.</p>
        </div>
        <div class="modal-footer">
          <button @click="showClearDialog = false" class="btn-secondary">Cancel</button>
          <button @click="clearAllRoutes" class="btn-danger">Clear All</button>
        </div>
      </div>
    </div>
    
    <!-- Snapshot Menu -->
    <div v-if="showSnapshotMenu" class="snapshot-menu">
      <button @click="saveSnapshot" class="menu-item">
        💾 Save Snapshot
      </button>
      <button @click="exportSnapshot" class="menu-item">
        ⬇️ Export Snapshot
      </button>
      <button @click="triggerImport" class="menu-item">
        ⬆️ Import Snapshot
      </button>
      <input 
        ref="fileInput" 
        type="file" 
        @change="importSnapshot" 
        accept=".json"
        style="display: none;"
      />
    </div>
    
    <!-- Loading Overlay -->
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <p>{{ loadingMessage }}</p>
    </div>
    
    <!-- Toast Notifications -->
    <div class="toast-container">
      <div 
        v-for="toast in toasts" 
        :key="toast.id" 
        :class="['toast', `toast-${toast.type}`]"
        @click="removeToast(toast.id)"
      >
        <span class="toast-icon">{{ toast.icon }}</span>
        <span class="toast-message">{{ toast.message }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'NmosMatrixDante',
  props: {
    nodeId: {
      type: String,
      required: true
    },
    uiStyle: {
      type: String,
      default: 'dante'
    },
    showMeters: {
      type: Boolean,
      default: false
    },
    confirmRoutes: {
      type: Boolean,
      default: true
    },
    compactView: {
      type: Boolean,
      default: false
    },
    matrixName: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      senders: [],
      receivers: [],
      routes: {},
      devices: [],
      selectedDevice: '',
      currentView: 'grid',
      routesLocked: false,
      loading: false,
      loadingMessage: 'Loading...',
      lastUpdate: null,
      highlightedSender: null,
      highlightedReceiver: null,
      listSearch: '',
      showConfirmDialog: false,
      showClearDialog: false,
      showSnapshotMenu: false,
      pendingRoute: null,
      pendingOperations: new Set(),
      toasts: [],
      toastIdCounter: 0,
      connectionError: null,
      avgLatency: 0
    }
  },
  computed: {
    filteredSenders() {
      if (!this.selectedDevice) return this.senders;
      return this.senders.filter(s => s.device_id === this.selectedDevice);
    },
    filteredReceivers() {
      if (!this.selectedDevice) return this.receivers;
      return this.receivers.filter(r => r.device_id === this.selectedDevice);
    },
    filteredReceiversList() {
      if (!this.listSearch) return this.filteredReceivers;
      const search = this.listSearch.toLowerCase();
      return this.filteredReceivers.filter(r => 
        r.label.toLowerCase().includes(search) ||
        (r.device_name && r.device_name.toLowerCase().includes(search))
      );
    },
    activeRoutesCount() {
      return Object.keys(this.routes).length;
    },
    emptyStateMessage() {
      if (this.selectedDevice) {
        return 'No endpoints found for selected device';
      }
      return 'Registry is connected but has no endpoints registered';
    }
  },
  mounted() {
    this.refreshEndpoints();
    this.refreshTimer = setInterval(() => {
      this.refreshEndpoints();
    }, 10000);
  },
  beforeUnmount() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  },
  methods: {
    async refreshEndpoints() {
      this.loading = true;
      this.loadingMessage = 'Refreshing endpoints...';
      this.connectionError = null;
      
      try {
        const response = await this.sendCommand({
          action: 'get_state'
        });
        
        if (response.event === 'state') {
          this.senders = response.senders || [];
          this.receivers = response.receivers || [];
          this.routes = response.routes || {};
          this.lastUpdate = new Date();
          
          // Extract devices
          this.extractDevices();
          
          if (this.senders.length === 0 && this.receivers.length === 0) {
            this.showToast('Registry connected but has no endpoints', 'warning');
          }
        }
      } catch (error) {
        console.error('Failed to refresh endpoints:', error);
        this.connectionError = {
          message: error.message || 'Failed to connect to registry',
          details: error.details || error.message,
          suggestions: error.suggestions || [
            'Verify the registry is running',
            'Check the matrix node configuration',
            'Ensure Node-RED can reach the registry'
          ]
        };
        this.showToast(this.connectionError.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    
    extractDevices() {
      const deviceMap = new Map();
      
      // Extract from senders
      this.senders.forEach(sender => {
        if (sender.device_id && !deviceMap.has(sender.device_id)) {
          deviceMap.set(sender.device_id, {
            id: sender.device_id,
            name: sender.device_name || sender.device_id
          });
        }
        // Add device name to sender for display
        sender.device_name = sender.device_name || '';
      });
      
      // Extract from receivers
      this.receivers.forEach(receiver => {
        if (receiver.device_id && !deviceMap.has(receiver.device_id)) {
          deviceMap.set(receiver.device_id, {
            id: receiver.device_id,
            name: receiver.device_name || receiver.device_id
          });
        }
        // Add device name to receiver for display
        receiver.device_name = receiver.device_name || '';
      });
      
      this.devices = Array.from(deviceMap.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
      );
    },
    
    loadDeviceMatrix() {
      // Filtering is handled by computed properties
      this.highlightedSender = null;
      this.highlightedReceiver = null;
    },
    
    handleCrosspointClick(senderId, receiverId) {
      if (this.routesLocked) {
        this.showToast('Routes are locked', 'warning');
        return;
      }
      
      const key = `${senderId}-${receiverId}`;
      if (this.pendingOperations.has(key)) return;
      
      const currentSenderId = this.routes[receiverId];
      
      if (currentSenderId === senderId) {
        // Disconnect
        this.initiateRoute(null, receiverId, 'disconnect');
      } else if (currentSenderId) {
        // Change route
        this.initiateRoute(senderId, receiverId, 'change');
      } else {
        // New connection
        this.initiateRoute(senderId, receiverId, 'connect');
      }
    },
    
    initiateRoute(senderId, receiverId, action) {
      if (this.confirmRoutes) {
        this.pendingRoute = { senderId, receiverId, action };
        this.showConfirmDialog = true;
      } else {
        this.executeRoute(senderId, receiverId, action);
      }
    },
    
    async confirmRoute() {
      this.showConfirmDialog = false;
      if (this.pendingRoute) {
        await this.executeRoute(
          this.pendingRoute.senderId,
          this.pendingRoute.receiverId,
          this.pendingRoute.action
        );
        this.pendingRoute = null;
      }
    },
    
    cancelRoute() {
      this.showConfirmDialog = false;
      this.pendingRoute = null;
    },
    
    async executeRoute(senderId, receiverId, action) {
      const key = `${senderId || 'null'}-${receiverId}`;
      this.pendingOperations.add(key);
      
      try {
        if (action === 'disconnect') {
          await this.sendCommand({
            action: 'disconnect',
            receiver_id: receiverId
          });
          delete this.routes[receiverId];
          this.showToast('Route disconnected', 'success');
        } else {
          await this.sendCommand({
            action: 'route',
            sender_id: senderId,
            receiver_id: receiverId
          });
          this.routes[receiverId] = senderId;
          this.showToast('Route connected', 'success');
        }
      } catch (error) {
        console.error('Routing failed:', error);
        this.showToast('Routing operation failed: ' + error.message, 'error');
      } finally {
        this.pendingOperations.delete(key);
      }
    },
    
    async routeFromList(event, receiverId) {
      const senderId = event.target.value;
      
      if (!senderId) {
        await this.initiateRoute(null, receiverId, 'disconnect');
      } else {
        const currentSenderId = this.routes[receiverId];
        const action = currentSenderId ? 'change' : 'connect';
        await this.initiateRoute(senderId, receiverId, action);
      }
    },
    
    async disconnectReceiver(receiverId) {
      await this.initiateRoute(null, receiverId, 'disconnect');
    },
    
    async clearAllRoutes() {
      this.showClearDialog = false;
      this.loading = true;
      this.loadingMessage = 'Clearing all routes...';
      
      try {
        const receivers = Object.keys(this.routes);
        for (const receiverId of receivers) {
          await this.sendCommand({
            action: 'disconnect',
            receiver_id: receiverId
          });
          delete this.routes[receiverId];
        }
        this.showToast('All routes cleared', 'success');
      } catch (error) {
        console.error('Failed to clear routes:', error);
        this.showToast('Failed to clear all routes', 'error');
      } finally {
        this.loading = false;
      }
    },
    
    toggleRouteLock() {
      this.routesLocked = !this.routesLocked;
      this.showToast(
        this.routesLocked ? 'Routes locked' : 'Routes unlocked',
        this.routesLocked ? 'warning' : 'info'
      );
    },
    
    getCrosspointClass(senderId, receiverId) {
      const key = `${senderId}-${receiverId}`;
      const classes = ['crosspoint'];
      
      if (this.pendingOperations.has(key)) {
        classes.push('pending');
      } else if (this.routes[receiverId] === senderId) {
        classes.push('connected');
      } else {
        classes.push('available');
      }
      
      if (this.highlightedSender === senderId || this.highlightedReceiver === receiverId) {
        classes.push('highlighted');
      }
      
      return classes.join(' ');
    },
    
    getCellIcon(senderId, receiverId) {
      const key = `${senderId}-${receiverId}`;
      
      if (this.pendingOperations.has(key)) {
        return '⏳';
      }
      
      if (this.routes[receiverId] === senderId) {
        return '●';
      }
      
      return '';
    },
    
    getCellTooltip(sender, receiver) {
      const isConnected = this.routes[receiver.id] === sender.id;
      
      if (isConnected) {
        return `Connected: ${sender.label} → ${receiver.label}\nClick to disconnect`;
      } else {
        return `Connect ${sender.label} → ${receiver.label}`;
      }
    },
    
    getSenderTooltip(sender) {
      return `Sender: ${sender.label}\nID: ${sender.id}\nDevice: ${sender.device_name || sender.device_id}`;
    },
    
    getReceiverTooltip(receiver) {
      return `Receiver: ${receiver.label}\nID: ${receiver.id}\nDevice: ${receiver.device_name || receiver.device_id}`;
    },
    
    getSenderLabel(senderId) {
      const sender = this.senders.find(s => s.id === senderId);
      return sender ? sender.label : 'Unknown';
    },
    
    getReceiverLabel(receiverId) {
      const receiver = this.receivers.find(r => r.id === receiverId);
      return receiver ? receiver.label : 'Unknown';
    },
    
    getStatusBadgeClass(receiverId) {
      return this.routes[receiverId] ? 'connected' : 'disconnected';
    },
    
    getStatusBadgeText(receiverId) {
      return this.routes[receiverId] ? 'Connected' : 'No Signal';
    },
    
    async saveSnapshot() {
      this.showSnapshotMenu = false;
      const name = prompt('Enter snapshot name:', 'Snapshot ' + new Date().toLocaleString());
      if (!name) return;
      
      this.loading = true;
      this.loadingMessage = 'Saving snapshot...';
      
      try {
        await this.sendCommand({
          action: 'save_snapshot',
          name: name,
          description: ''
        });
        this.showToast('Snapshot saved', 'success');
      } catch (error) {
        console.error('Failed to save snapshot:', error);
        this.showToast('Failed to save snapshot', 'error');
      } finally {
        this.loading = false;
      }
    },
    
    async exportSnapshot() {
      this.showSnapshotMenu = false;
      this.loading = true;
      this.loadingMessage = 'Exporting snapshot...';
      
      try {
        const response = await this.sendCommand({
          action: 'save_snapshot',
          name: 'Export ' + new Date().toISOString(),
          description: 'Exported snapshot'
        });
        
        if (response.event === 'snapshot_saved') {
          const snapshot = response.snapshot;
          const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `nmos-routing-snapshot-${Date.now()}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.showToast('Snapshot exported', 'success');
        }
      } catch (error) {
        console.error('Failed to export snapshot:', error);
        this.showToast('Failed to export snapshot', 'error');
      } finally {
        this.loading = false;
      }
    },
    
    triggerImport() {
      this.showSnapshotMenu = false;
      this.$refs.fileInput.click();
    },
    
    async importSnapshot(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      this.loading = true;
      this.loadingMessage = 'Importing snapshot...';
      
      try {
        const text = await file.text();
        const snapshot = JSON.parse(text);
        
        await this.sendCommand({
          action: 'load_snapshot',
          snapshot: snapshot
        });
        
        await this.refreshEndpoints();
        this.showToast('Snapshot imported', 'success');
      } catch (error) {
        console.error('Failed to import snapshot:', error);
        this.showToast('Failed to import snapshot', 'error');
      } finally {
        this.loading = false;
        event.target.value = '';
      }
    },
    
    async sendCommand(payload) {
      const response = await fetch(`/nmos-matrix/${this.nodeId}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ payload })
      });
      
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = null;
        }
        
        if (errorData && errorData.message) {
          const error = new Error(errorData.message);
          error.details = errorData.details;
          error.suggestions = errorData.suggestions;
          throw error;
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    },
    
    retryConnection() {
      this.connectionError = null;
      this.refreshEndpoints();
    },
    
    showToast(message, type = 'info') {
      const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
      };
      
      const toast = {
        id: ++this.toastIdCounter,
        message,
        type,
        icon: icons[type] || icons.info
      };
      
      this.toasts.push(toast);
      
      setTimeout(() => {
        this.removeToast(toast.id);
      }, 3000);
    },
    
    removeToast(id) {
      const index = this.toasts.findIndex(t => t.id === id);
      if (index !== -1) {
        this.toasts.splice(index, 1);
      }
    }
  }
}
</script>

<style scoped>
.nmos-matrix-dante {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  background: #1e1e1e;
  color: #ffffff;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Dante-Style Toolbar */
.dante-toolbar {
  background: linear-gradient(180deg, #2d2d2d 0%, #1e1e1e 100%);
  border-bottom: 1px solid #3a3a3a;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-shrink: 0;
}

.toolbar-left {
  flex: 0 0 auto;
}

.matrix-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #e0e0e0;
}

.toolbar-center {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 20px;
  justify-content: center;
}

.view-switcher {
  display: flex;
  background: #2a2a2a;
  border-radius: 6px;
  overflow: hidden;
}

.view-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.view-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.view-btn.active {
  background: #0078d4;
  color: #fff;
}

.view-btn .icon {
  font-size: 16px;
}

.device-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.device-selector label {
  font-size: 13px;
  color: #999;
}

.device-selector select {
  padding: 6px 12px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.toolbar-right {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
}

.toolbar-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: #2a2a2a;
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar-btn:hover:not(:disabled) {
  background: #3a3a3a;
  transform: translateY(-1px);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn.active {
  background: #0078d4;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid #333;
  border-top-color: #0078d4;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

/* Status Panel */
.status-panel {
  background: #252525;
  border-bottom: 1px solid #3a3a3a;
  padding: 12px 20px;
  display: flex;
  gap: 20px;
  flex-shrink: 0;
}

.status-card {
  flex: 1;
  text-align: center;
  padding: 8px;
  background: #2a2a2a;
  border-radius: 6px;
}

.status-label {
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.status-value {
  font-size: 24px;
  font-weight: 700;
  color: #0078d4;
}

/* Matrix Grid View */
.matrix-view {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.matrix-grid-wrapper {
  overflow: auto;
}

.dante-matrix-table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
}

.corner-cell {
  background: #252525;
  padding: 12px;
  font-weight: 600;
  font-size: 13px;
  color: #999;
  position: sticky;
  left: 0;
  top: 0;
  z-index: 20;
  border-right: 1px solid #3a3a3a;
  border-bottom: 1px solid #3a3a3a;
}

.sender-header {
  background: #2a2a2a;
  padding: 12px 8px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  min-width: 80px;
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid #3a3a3a;
  transition: background 0.2s;
}

.sender-header.highlighted {
  background: #3a3a3a;
}

.header-label {
  color: #e0e0e0;
  margin-bottom: 2px;
}

.header-device {
  font-size: 10px;
  color: #666;
}

.receiver-label {
  background: #2a2a2a;
  padding: 12px;
  font-size: 12px;
  font-weight: 600;
  min-width: 150px;
  position: sticky;
  left: 0;
  z-index: 10;
  border-right: 1px solid #3a3a3a;
  transition: background 0.2s;
}

.receiver-label.highlighted {
  background: #3a3a3a;
}

.label-text {
  color: #e0e0e0;
  margin-bottom: 2px;
}

.label-device {
  font-size: 10px;
  color: #666;
}

.crosspoint {
  width: 80px;
  height: 60px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #1e1e1e;
  border: 1px solid #2a2a2a;
  position: relative;
}

.crosspoint:hover:not(.pending) {
  background: #2a3540;
  border-color: #0078d4;
}

.crosspoint.connected {
  background: linear-gradient(135deg, #0b6d3a 0%, #0a5a2f 100%);
  border-color: #0b6d3a;
}

.crosspoint.pending {
  background: linear-gradient(135deg, #d4740b 0%, #b36309 100%);
  animation: pulse 1.5s infinite;
}

.crosspoint.highlighted {
  box-shadow: 0 0 0 2px #0078d4;
}

.crosspoint-indicator {
  font-size: 20px;
  line-height: 60px;
  color: #fff;
}

.compact-view .crosspoint {
  width: 50px;
  height: 40px;
}

.compact-view .crosspoint-indicator {
  font-size: 16px;
  line-height: 40px;
}

/* List View */
.list-view {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.list-search {
  margin-bottom: 16px;
}

.search-input {
  width: 100%;
  max-width: 400px;
  padding: 10px 16px;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  background: #2a2a2a;
  color: #fff;
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: #0078d4;
}

.receiver-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.receiver-item {
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  transition: all 0.2s;
}

.receiver-item:hover {
  background: #323232;
  border-color: #444;
}

.receiver-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.receiver-icon {
  font-size: 24px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1e1e1e;
  border-radius: 6px;
}

.receiver-details {
  flex: 1;
}

.receiver-name {
  font-size: 14px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 2px;
}

.receiver-device {
  font-size: 12px;
  color: #666;
}

.receiver-routing {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sender-dropdown {
  padding: 8px 12px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  min-width: 200px;
  cursor: pointer;
}

.sender-dropdown:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.status-badge.connected {
  background: rgba(11, 109, 58, 0.3);
  color: #0fc764;
  border: 1px solid #0b6d3a;
}

.status-badge.disconnected {
  background: rgba(102, 102, 102, 0.3);
  color: #999;
  border: 1px solid #555;
}

.disconnect-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: #d13438;
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.disconnect-btn:hover:not(:disabled) {
  background: #a02a2d;
}

.disconnect-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 20px;
  opacity: 0.5;
}

.empty-state h3 {
  margin: 0 0 10px 0;
  color: #999;
  font-size: 20px;
}

.empty-state p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-dialog {
  background: #2a2a2a;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 20px;
  border-bottom: 1px solid #3a3a3a;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  color: #e0e0e0;
}

.modal-body {
  padding: 20px;
  color: #ccc;
}

.modal-body p {
  margin: 0 0 12px 0;
  line-height: 1.6;
}

.modal-footer {
  padding: 20px;
  border-top: 1px solid #3a3a3a;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-primary, .btn-secondary, .btn-danger {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary {
  background: #0078d4;
  color: white;
}

.btn-primary:hover {
  background: #006abc;
}

.btn-secondary {
  background: #555;
  color: white;
}

.btn-secondary:hover {
  background: #666;
}

.btn-danger {
  background: #d13438;
  color: white;
}

.btn-danger:hover {
  background: #a02a2d;
}

/* Snapshot Menu */
.snapshot-menu {
  position: absolute;
  top: 60px;
  right: 20px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  z-index: 100;
  overflow: hidden;
}

.menu-item {
  width: 100%;
  padding: 12px 20px;
  border: none;
  background: transparent;
  color: #e0e0e0;
  text-align: left;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.menu-item:hover {
  background: #323232;
}

/* Error Banner */
.error-banner {
  background: rgba(209, 52, 56, 0.1);
  border: 2px solid #d13438;
  border-radius: 8px;
  padding: 20px;
  margin: 20px;
  display: flex;
  gap: 15px;
}

.error-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.error-content {
  flex: 1;
}

.error-content h3 {
  margin: 0 0 10px 0;
  color: #d13438;
  font-size: 16px;
}

.error-content p {
  margin: 5px 0;
  color: #ccc;
}

.suggestions-list {
  list-style: none;
  padding: 10px 0;
  margin: 10px 0 0 0;
}

.suggestions-list li {
  padding: 4px 0;
  color: #999;
}

.suggestions-list li:before {
  content: "💡 ";
  margin-right: 5px;
}

/* Loading Overlay */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #333;
  border-top-color: #0078d4;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

.loading-overlay p {
  color: #ccc;
  font-size: 14px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Toast Notifications */
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 400px;
}

.toast {
  background: #2a2a2a;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  animation: slideIn 0.3s ease-out;
  border-left: 4px solid;
}

.toast-success {
  border-left-color: #0fc764;
}

.toast-error {
  border-left-color: #d13438;
}

.toast-warning {
  border-left-color: #d47b0b;
}

.toast-info {
  border-left-color: #0078d4;
}

.toast-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
  font-size: 13px;
  color: #e0e0e0;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
</style>
