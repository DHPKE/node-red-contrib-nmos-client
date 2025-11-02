<template>
  <div class="nmos-matrix-container" :class="{'compact-view': compactView, [`theme-${colorScheme}`]: true}">
    <!-- Matrix Controls -->
    <div class="matrix-controls">
      <div class="control-group">
        <input 
          v-model="searchSender" 
          type="text"
          placeholder="Search senders..." 
          class="search-input"
        />
        <input 
          v-model="searchReceiver" 
          type="text"
          placeholder="Search receivers..." 
          class="search-input"
        />
      </div>
      
      <div class="control-group">
        <button @click="refreshEndpoints" class="btn btn-primary" :disabled="loading">
          <span v-if="!loading">🔄</span>
          <span v-else>⏳</span>
          Refresh
        </button>
        <button @click="showSaveDialog = true" class="btn btn-success">
          💾 Save Snapshot
        </button>
        <button @click="exportSnapshot" class="btn btn-info">
          ⬇️ Export
        </button>
        <button @click="triggerImport" class="btn btn-warning">
          ⬆️ Import
        </button>
        <input 
          ref="fileInput" 
          type="file" 
          @change="importSnapshot" 
          accept=".json"
          style="display: none;"
        />
      </div>
      
      <div class="status-bar">
        <span class="status-item">
          <strong>Senders:</strong> {{ filteredSenders.length }}
        </span>
        <span class="status-item">
          <strong>Receivers:</strong> {{ filteredReceivers.length }}
        </span>
        <span class="status-item">
          <strong>Active Routes:</strong> {{ activeRoutesCount }}
        </span>
        <span class="status-item" v-if="lastUpdate">
          <strong>Updated:</strong> {{ formatTime(lastUpdate) }}
        </span>
      </div>
    </div>
    
    <!-- Matrix Grid -->
    <div class="matrix-wrapper" v-if="filteredSenders.length > 0 && filteredReceivers.length > 0">
      <div class="matrix-grid">
        <table class="matrix-table">
          <thead>
            <tr>
              <th class="corner-cell"></th>
              <th 
                v-for="sender in filteredSenders" 
                :key="sender.id"
                class="sender-header"
                :title="getSenderTooltip(sender)"
              >
                <div class="header-content">
                  <span v-if="showLabels">{{ sender.label }}</span>
                  <span v-else>S{{ filteredSenders.indexOf(sender) + 1 }}</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="receiver in filteredReceivers" :key="receiver.id">
              <td 
                class="receiver-label"
                :title="getReceiverTooltip(receiver)"
              >
                <div class="label-content">
                  <span v-if="showLabels">{{ receiver.label }}</span>
                  <span v-else>R{{ filteredReceivers.indexOf(receiver) + 1 }}</span>
                </div>
              </td>
              <td 
                v-for="sender in filteredSenders" 
                :key="sender.id"
                :class="getCellClass(sender.id, receiver.id)"
                @click="toggleRoute(sender.id, receiver.id)"
                :title="getCellTooltip(sender, receiver)"
                class="crosspoint"
              >
                <span class="connection-indicator">
                  {{ getCellIcon(sender.id, receiver.id) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
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
        <div class="error-actions">
          <button @click="retryConnection" class="btn btn-primary">
            🔄 Retry Connection
          </button>
          <button @click="toggleDebugMode" class="btn btn-secondary">
            🐛 {{ debugMode ? 'Hide' : 'Show' }} Debug Info
          </button>
        </div>
      </div>
    </div>
    
    <!-- Empty State -->
    <div v-else-if="!loading && !connectionError && senders.length === 0 && receivers.length === 0" class="empty-state">
      <div class="empty-icon">📡</div>
      <h3>No Endpoints Found</h3>
      <p>Registry is connected but has no senders or receivers registered.</p>
      <ul class="suggestions-list">
        <li>Check if NMOS devices are running</li>
        <li>Verify devices are configured to register with this registry</li>
        <li>Ensure devices are on the same network</li>
      </ul>
      <button @click="refreshEndpoints" class="btn btn-primary">
        🔄 Refresh
      </button>
    </div>
    
    <!-- Debug Info Panel -->
    <div v-if="debugMode" class="debug-panel">
      <h4>🐛 Debug Information</h4>
      <div class="debug-item">
        <strong>Node ID:</strong> {{ nodeId }}
      </div>
      <div class="debug-item">
        <strong>Last Update:</strong> {{ lastUpdate ? formatTime(lastUpdate) : 'Never' }}
      </div>
      <div class="debug-item">
        <strong>Senders:</strong> {{ senders.length }}
      </div>
      <div class="debug-item">
        <strong>Receivers:</strong> {{ receivers.length }}
      </div>
      <div class="debug-item">
        <strong>Active Routes:</strong> {{ activeRoutesCount }}
      </div>
      <div class="debug-item" v-if="connectionError">
        <strong>Last Error:</strong> 
        <pre>{{ JSON.stringify(connectionError, null, 2) }}</pre>
      </div>
      <button @click="showRawData" class="btn btn-info btn-sm">
        Show Raw API Data
      </button>
    </div>
    
    <!-- Save Snapshot Dialog -->
    <div v-if="showSaveDialog" class="modal-overlay" @click="showSaveDialog = false">
      <div class="modal-dialog" @click.stop>
        <div class="modal-header">
          <h3>💾 Save Snapshot</h3>
          <button @click="showSaveDialog = false" class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Snapshot Name</label>
            <input 
              v-model="snapshotName" 
              type="text" 
              placeholder="e.g., Production Setup 1"
              class="form-control"
            />
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea 
              v-model="snapshotDescription" 
              placeholder="e.g., Main routing configuration for live broadcast"
              class="form-control"
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="showSaveDialog = false" class="btn btn-secondary">Cancel</button>
          <button @click="saveSnapshot" class="btn btn-success">Save Snapshot</button>
        </div>
      </div>
    </div>
    
    <!-- Import Preview Dialog -->
    <div v-if="showImportDialog" class="modal-overlay" @click="showImportDialog = false">
      <div class="modal-dialog modal-lg" @click.stop>
        <div class="modal-header">
          <h3>⬆️ Import Snapshot</h3>
          <button @click="showImportDialog = false" class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="importedSnapshot">
            <div class="snapshot-info">
              <h4>Snapshot Information</h4>
              <dl>
                <dt>Name:</dt>
                <dd>{{ importedSnapshot.name }}</dd>
                <dt>Description:</dt>
                <dd>{{ importedSnapshot.description || 'N/A' }}</dd>
                <dt>Timestamp:</dt>
                <dd>{{ formatTime(importedSnapshot.timestamp) }}</dd>
                <dt>Total Routes:</dt>
                <dd>{{ importedSnapshot.routes.length }}</dd>
              </dl>
            </div>
            
            <div v-if="validationResult" class="validation-result">
              <h4>Validation Results</h4>
              <div class="validation-stats">
                <div class="stat success">
                  <span class="stat-label">✅ Valid Routes:</span>
                  <span class="stat-value">{{ validationResult.validRoutes }}</span>
                </div>
                <div class="stat error" v-if="validationResult.invalidRoutes > 0">
                  <span class="stat-label">❌ Invalid Routes:</span>
                  <span class="stat-value">{{ validationResult.invalidRoutes }}</span>
                </div>
                <div class="stat warning" v-if="validationResult.changes > 0">
                  <span class="stat-label">🔄 Changes:</span>
                  <span class="stat-value">{{ validationResult.changes }}</span>
                </div>
              </div>
              
              <div v-if="validationResult.invalidRoutes > 0" class="invalid-routes">
                <h5>Invalid Routes (will be skipped):</h5>
                <ul>
                  <li v-for="(route, idx) in validationResult.invalidRoutesList" :key="idx">
                    {{ route.sender_label }} → {{ route.receiver_label }}: {{ route.reason }}
                  </li>
                </ul>
              </div>
              
              <div v-if="validationResult.changes > 0" class="routing-changes">
                <h5>Routing Changes:</h5>
                <ul>
                  <li v-for="(change, idx) in validationResult.changesList" :key="idx">
                    <span :class="'change-type-' + change.type">{{ change.icon }}</span>
                    {{ change.description }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="showImportDialog = false" class="btn btn-secondary">Cancel</button>
          <button 
            @click="applySnapshot" 
            class="btn btn-warning" 
            :disabled="!validationResult || validationResult.validRoutes === 0"
          >
            Apply Snapshot
          </button>
        </div>
      </div>
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
  name: 'NmosMatrix',
  props: {
    nodeId: {
      type: String,
      required: true
    },
    compactView: {
      type: Boolean,
      default: false
    },
    showLabels: {
      type: Boolean,
      default: true
    },
    colorScheme: {
      type: String,
      default: 'default'
    }
  },
  data() {
    return {
      senders: [],
      receivers: [],
      routes: {},
      searchSender: '',
      searchReceiver: '',
      loading: false,
      loadingMessage: 'Loading...',
      lastUpdate: null,
      showSaveDialog: false,
      showImportDialog: false,
      snapshotName: '',
      snapshotDescription: '',
      importedSnapshot: null,
      validationResult: null,
      pendingOperations: new Set(),
      toasts: [],
      toastIdCounter: 0,
      connectionError: null,
      debugMode: false
    }
  },
  computed: {
    filteredSenders() {
      if (!this.searchSender) return this.senders;
      const search = this.searchSender.toLowerCase();
      return this.senders.filter(s => 
        s.label.toLowerCase().includes(search) ||
        s.id.toLowerCase().includes(search)
      );
    },
    filteredReceivers() {
      if (!this.searchReceiver) return this.receivers;
      const search = this.searchReceiver.toLowerCase();
      return this.receivers.filter(r => 
        r.label.toLowerCase().includes(search) ||
        r.id.toLowerCase().includes(search)
      );
    },
    activeRoutesCount() {
      return Object.keys(this.routes).length;
    }
  },
  mounted() {
    this.refreshEndpoints();
    // Auto-refresh every 10 seconds
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
        // Send refresh command to Node-RED backend
        const response = await this.sendCommand({
          action: 'get_state'
        });
        
        if (response.event === 'state') {
          this.senders = response.senders || [];
          this.receivers = response.receivers || [];
          this.routes = response.routes || {};
          this.lastUpdate = new Date();
          
          // Show info if registry is empty
          if (this.senders.length === 0 && this.receivers.length === 0) {
            this.showToast('Registry connected but has no endpoints', 'warning');
          }
        }
      } catch (error) {
        console.error('Failed to refresh endpoints:', error);
        
        // Parse error details
        let errorMessage = 'Failed to connect to registry';
        let errorDetails = error.message;
        let suggestions = [];
        
        if (error.message.includes('Connection refused')) {
          errorMessage = 'Connection Refused';
          errorDetails = 'Cannot connect to the NMOS registry';
          suggestions = [
            'Verify the registry URL is correct',
            'Check if the registry is running',
            'Ensure Node-RED can reach the registry network',
            'Verify firewall settings'
          ];
        } else if (error.message.includes('Host not found')) {
          errorMessage = 'Host Not Found';
          errorDetails = 'Invalid registry hostname or IP address';
          suggestions = [
            'Verify the hostname or IP address is correct',
            'Check DNS resolution',
            'Try using IP address instead of hostname'
          ];
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Connection Timeout';
          errorDetails = 'Registry did not respond in time';
          suggestions = [
            'Check network connectivity',
            'Verify the registry is responding',
            'Increase the timeout setting if registry is slow'
          ];
        } else if (error.message.includes('404')) {
          errorMessage = 'Registry Not Found';
          errorDetails = 'The registry endpoint does not exist';
          suggestions = [
            'Verify the API version is correct',
            'Check the registry URL path',
            'Ensure the registry supports IS-04 Query API'
          ];
        } else if (error.message.includes('Matrix node not found')) {
          errorMessage = 'Configuration Error';
          errorDetails = 'The matrix node is not properly configured';
          suggestions = [
            'Redeploy the Node-RED flow',
            'Check the matrix node configuration',
            'Restart Node-RED'
          ];
        }
        
        this.connectionError = {
          message: errorMessage,
          details: errorDetails,
          suggestions: suggestions
        };
        
        this.showToast(errorMessage, 'error');
      } finally {
        this.loading = false;
      }
    },
    
    async toggleRoute(senderId, receiverId) {
      const key = `${senderId}-${receiverId}`;
      
      // Prevent double-clicks
      if (this.pendingOperations.has(key)) return;
      this.pendingOperations.add(key);
      
      try {
        const isConnected = this.routes[receiverId] === senderId;
        
        if (isConnected) {
          // Disconnect
          await this.sendCommand({
            action: 'disconnect',
            receiver_id: receiverId
          });
          delete this.routes[receiverId];
        } else {
          // Connect
          await this.sendCommand({
            action: 'route',
            sender_id: senderId,
            receiver_id: receiverId
          });
          this.routes[receiverId] = senderId;
        }
      } catch (error) {
        console.error('Routing failed:', error);
        this.showError('Routing operation failed');
      } finally {
        this.pendingOperations.delete(key);
      }
    },
    
    getCellClass(senderId, receiverId) {
      const key = `${senderId}-${receiverId}`;
      
      if (this.pendingOperations.has(key)) {
        return 'pending';
      }
      
      if (this.routes[receiverId] === senderId) {
        return 'active';
      }
      
      return 'inactive';
    },
    
    getCellIcon(senderId, receiverId) {
      const key = `${senderId}-${receiverId}`;
      
      if (this.pendingOperations.has(key)) {
        return '🔄';
      }
      
      if (this.routes[receiverId] === senderId) {
        return '✅';
      }
      
      return '⭕';
    },
    
    getCellTooltip(sender, receiver) {
      const isConnected = this.routes[receiver.id] === sender.id;
      
      if (isConnected) {
        return `Active: ${sender.label} → ${receiver.label}\nClick to disconnect`;
      } else {
        return `Connect ${sender.label} → ${receiver.label}`;
      }
    },
    
    getSenderTooltip(sender) {
      return `Sender: ${sender.label}\nID: ${sender.id}\nDevice: ${sender.device_id}`;
    },
    
    getReceiverTooltip(receiver) {
      return `Receiver: ${receiver.label}\nID: ${receiver.id}\nDevice: ${receiver.device_id}`;
    },
    
    async saveSnapshot() {
      if (!this.snapshotName.trim()) {
        this.showToast('Please enter a snapshot name', 'warning');
        return;
      }
      
      this.loading = true;
      this.loadingMessage = 'Saving snapshot...';
      
      try {
        await this.sendCommand({
          action: 'save_snapshot',
          name: this.snapshotName,
          description: this.snapshotDescription
        });
        
        this.showSaveDialog = false;
        this.snapshotName = '';
        this.snapshotDescription = '';
        this.showToast('Snapshot saved successfully', 'success');
      } catch (error) {
        console.error('Failed to save snapshot:', error);
        this.showToast('Failed to save snapshot', 'error');
      } finally {
        this.loading = false;
      }
    },
    
    async exportSnapshot() {
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
        }
      } catch (error) {
        console.error('Failed to export snapshot:', error);
        this.showError('Failed to export snapshot');
      } finally {
        this.loading = false;
      }
    },
    
    triggerImport() {
      this.$refs.fileInput.click();
    },
    
    async importSnapshot(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      this.loading = true;
      this.loadingMessage = 'Importing and validating snapshot...';
      
      try {
        const text = await file.text();
        const snapshot = JSON.parse(text);
        
        // Validate snapshot
        this.importedSnapshot = snapshot;
        this.validationResult = this.validateSnapshot(snapshot);
        this.showImportDialog = true;
      } catch (error) {
        console.error('Failed to import snapshot:', error);
        this.showToast('Invalid snapshot file', 'error');
      } finally {
        this.loading = false;
        // Reset file input
        event.target.value = '';
      }
    },
    
    validateSnapshot(snapshot) {
      if (!snapshot || !snapshot.routes || !Array.isArray(snapshot.routes)) {
        return null;
      }
      
      let validRoutes = 0;
      let invalidRoutes = 0;
      let changes = 0;
      const invalidRoutesList = [];
      const changesList = [];
      
      snapshot.routes.forEach(route => {
        const sender = this.senders.find(s => s.id === route.sender_id);
        const receiver = this.receivers.find(r => r.id === route.receiver_id);
        
        if (!sender || !receiver) {
          invalidRoutes++;
          invalidRoutesList.push({
            ...route,
            reason: !sender ? 'Sender not found' : 'Receiver not found'
          });
        } else {
          validRoutes++;
          
          // Check if this would change current routing
          const currentSenderId = this.routes[route.receiver_id];
          
          if (!currentSenderId) {
            changes++;
            changesList.push({
              type: 'add',
              icon: '➕',
              description: `Add: ${route.sender_label} → ${route.receiver_label}`
            });
          } else if (currentSenderId !== route.sender_id) {
            changes++;
            const currentSender = this.senders.find(s => s.id === currentSenderId);
            changesList.push({
              type: 'change',
              icon: '🔄',
              description: `Change: ${route.receiver_label} from ${currentSender?.label || 'Unknown'} to ${route.sender_label}`
            });
          }
        }
      });
      
      // Check for routes that would be removed
      Object.keys(this.routes).forEach(receiverId => {
        const existsInSnapshot = snapshot.routes.some(r => r.receiver_id === receiverId);
        if (!existsInSnapshot) {
          changes++;
          const receiver = this.receivers.find(r => r.id === receiverId);
          const sender = this.senders.find(s => s.id === this.routes[receiverId]);
          changesList.push({
            type: 'remove',
            icon: '➖',
            description: `Remove: ${sender?.label || 'Unknown'} → ${receiver?.label || 'Unknown'}`
          });
        }
      });
      
      return {
        validRoutes,
        invalidRoutes,
        changes,
        invalidRoutesList,
        changesList
      };
    },
    
    async applySnapshot() {
      if (!this.importedSnapshot) return;
      
      this.loading = true;
      this.loadingMessage = 'Applying snapshot...';
      
      try {
        await this.sendCommand({
          action: 'load_snapshot',
          snapshot: this.importedSnapshot
        });
        
        this.showImportDialog = false;
        this.importedSnapshot = null;
        this.validationResult = null;
        
        // Refresh to get updated state
        await this.refreshEndpoints();
        
        this.showToast('Snapshot applied successfully', 'success');
      } catch (error) {
        console.error('Failed to apply snapshot:', error);
        this.showToast('Failed to apply snapshot', 'error');
      } finally {
        this.loading = false;
      }
    },
    
    async sendCommand(payload) {
      // This would typically use Node-RED's msg passing or HTTP API
      // For now, we'll use a simple HTTP approach
      const response = await fetch(`/nmos-matrix/${this.nodeId}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ payload })
      });
      
      if (!response.ok) {
        const statusMessages = {
          400: 'Invalid request parameters',
          404: 'Matrix node not found',
          500: 'Server error occurred',
          503: 'Registry unavailable'
        };
        const message = statusMessages[response.status] || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(message);
      }
      
      return await response.json();
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
      
      // Auto-remove after 3 seconds
      setTimeout(() => {
        this.removeToast(toast.id);
      }, 3000);
    },
    
    removeToast(id) {
      const index = this.toasts.findIndex(t => t.id === id);
      if (index !== -1) {
        this.toasts.splice(index, 1);
      }
    },
    
    formatTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    },
    
    retryConnection() {
      this.connectionError = null;
      this.refreshEndpoints();
    },
    
    toggleDebugMode() {
      this.debugMode = !this.debugMode;
    },
    
    showRawData() {
      const data = {
        senders: this.senders,
        receivers: this.receivers,
        routes: this.routes,
        lastUpdate: this.lastUpdate,
        nodeId: this.nodeId
      };
      
      // Open in new window with formatted JSON
      const win = window.open('', '_blank');
      win.document.write('<html><head><title>NMOS Matrix Raw Data</title></head><body>');
      win.document.write('<pre>' + JSON.stringify(data, null, 2) + '</pre>');
      win.document.write('</body></html>');
      win.document.close();
    }
  }
}
</script>

<style scoped>
.nmos-matrix-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  background: #1a1a1a;
  color: #ffffff;
  padding: 20px;
  border-radius: 8px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.matrix-controls {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.control-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.search-input {
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  border: 1px solid #444;
  border-radius: 4px;
  background: #2a2a2a;
  color: #fff;
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: #3FADB5;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #3FADB5;
  color: white;
}

.btn-success {
  background: #4CAF50;
  color: white;
}

.btn-info {
  background: #2196F3;
  color: white;
}

.btn-warning {
  background: #FF9800;
  color: white;
}

.btn-secondary {
  background: #666;
  color: white;
}

.status-bar {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  padding: 10px;
  background: #2a2a2a;
  border-radius: 4px;
  font-size: 13px;
}

.status-item {
  display: flex;
  gap: 5px;
}

.matrix-wrapper {
  flex: 1;
  overflow: auto;
  background: #2a2a2a;
  border-radius: 4px;
  padding: 10px;
}

.matrix-table {
  border-collapse: separate;
  border-spacing: 2px;
  width: 100%;
}

.corner-cell {
  background: #1a1a1a;
  min-width: 150px;
  position: sticky;
  left: 0;
  z-index: 10;
}

.sender-header {
  background: #2a4a5a;
  padding: 10px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  min-width: 60px;
  position: sticky;
  top: 0;
  z-index: 5;
}

.receiver-label {
  background: #2a4a5a;
  padding: 10px;
  font-size: 12px;
  font-weight: 600;
  min-width: 150px;
  position: sticky;
  left: 0;
  z-index: 5;
}

.crosspoint {
  width: 60px;
  height: 60px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #333;
}

.crosspoint:hover {
  background: #444;
  transform: scale(1.05);
}

.crosspoint.active {
  background: linear-gradient(135deg, #3FADB5 0%, #2d8a91 100%);
}

.crosspoint.pending {
  background: linear-gradient(135deg, #FFA726 0%, #FB8C00 100%);
  animation: pulse 1s infinite;
}

.crosspoint.inactive {
  background: #333;
}

.connection-indicator {
  font-size: 24px;
  display: inline-block;
}

.compact-view .crosspoint {
  width: 40px;
  height: 40px;
}

.compact-view .connection-indicator {
  font-size: 18px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

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
  max-height: 90vh;
  overflow: auto;
}

.modal-dialog.modal-lg {
  max-width: 800px;
}

.modal-header {
  padding: 20px;
  border-bottom: 1px solid #444;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: #fff;
  font-size: 28px;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  line-height: 1;
}

.modal-body {
  padding: 20px;
}

.modal-footer {
  padding: 20px;
  border-top: 1px solid #444;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: 600;
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #444;
  border-radius: 4px;
  background: #1a1a1a;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
}

.form-control:focus {
  outline: none;
  border-color: #3FADB5;
}

.snapshot-info, .validation-result {
  margin-bottom: 20px;
}

.snapshot-info h4, .validation-result h4 {
  margin-bottom: 10px;
  color: #3FADB5;
}

.snapshot-info dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 5px 15px;
}

.snapshot-info dt {
  font-weight: 600;
}

.validation-stats {
  display: flex;
  gap: 20px;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.stat {
  padding: 10px 15px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.stat.success {
  background: rgba(76, 175, 80, 0.2);
  border: 1px solid #4CAF50;
}

.stat.error {
  background: rgba(244, 67, 54, 0.2);
  border: 1px solid #F44336;
}

.stat.warning {
  background: rgba(255, 152, 0, 0.2);
  border: 1px solid #FF9800;
}

.stat-label {
  font-size: 12px;
  opacity: 0.8;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
}

.invalid-routes, .routing-changes {
  margin-top: 15px;
}

.invalid-routes h5, .routing-changes h5 {
  margin-bottom: 10px;
  color: #FF9800;
}

.invalid-routes ul, .routing-changes ul {
  list-style: none;
  padding: 0;
}

.invalid-routes li, .routing-changes li {
  padding: 8px;
  margin-bottom: 5px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  font-size: 13px;
}

.change-type-add {
  color: #4CAF50;
}

.change-type-remove {
  color: #F44336;
}

.change-type-change {
  color: #FF9800;
}

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
  border-top-color: #3FADB5;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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
  padding: 15px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  animation: slideIn 0.3s ease-out;
  border-left: 4px solid;
}

.toast-success {
  border-left-color: #4CAF50;
}

.toast-error {
  border-left-color: #F44336;
}

.toast-warning {
  border-left-color: #FF9800;
}

.toast-info {
  border-left-color: #2196F3;
}

.toast-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
  font-size: 14px;
  color: #fff;
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

/* Error Banner */
.error-banner {
  background: rgba(244, 67, 54, 0.1);
  border: 2px solid #F44336;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  display: flex;
  gap: 15px;
}

.error-icon {
  font-size: 48px;
  flex-shrink: 0;
}

.error-content {
  flex: 1;
}

.error-content h3 {
  margin: 0 0 10px 0;
  color: #F44336;
  font-size: 18px;
}

.error-content p {
  margin: 5px 0;
  color: #ccc;
}

.suggestions-list {
  list-style: none;
  padding: 10px 0;
  margin: 10px 0;
}

.suggestions-list li {
  padding: 5px 0;
  color: #999;
}

.suggestions-list li:before {
  content: "💡 ";
  margin-right: 5px;
}

.error-actions {
  margin-top: 15px;
  display: flex;
  gap: 10px;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

/* Debug Panel */
.debug-panel {
  background: rgba(33, 150, 243, 0.1);
  border: 2px solid #2196F3;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 20px;
}

.debug-panel h4 {
  margin: 0 0 10px 0;
  color: #2196F3;
  font-size: 16px;
}

.debug-item {
  padding: 5px 0;
  font-size: 13px;
  color: #ccc;
}

.debug-item strong {
  color: #fff;
  margin-right: 10px;
}

.debug-item pre {
  background: rgba(0, 0, 0, 0.3);
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
  margin-top: 5px;
  font-size: 11px;
}

/* Theme variations */
.theme-dark {
  background: #1a1a1a;
  color: #ffffff;
}

.theme-light {
  background: #f5f5f5;
  color: #000000;
}

.theme-light .search-input,
.theme-light .form-control {
  background: #ffffff;
  color: #000000;
}

.theme-highcontrast .crosspoint.active {
  background: #00ff00;
  color: #000000;
}
</style>
