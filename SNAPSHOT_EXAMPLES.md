# NMOS Matrix Snapshot Examples

This guide provides practical examples of using the snapshot functionality in the NMOS Dynamic Matrix Flow.

## Table of Contents
- [Basic Snapshot Operations](#basic-snapshot-operations)
- [Programmatic Usage](#programmatic-usage)
- [Automation Examples](#automation-examples)
- [Snapshot JSON Format](#snapshot-json-format)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Basic Snapshot Operations

### Creating a Snapshot

1. **Via Web UI**:
   - Open `http://localhost:1880/nmos-matrix`
   - Click the **💾 Save Snapshot** button
   - Enter a descriptive name: "Live Show - Camera Setup"
   - Add description: "Main camera routing for broadcast"
   - Click **Save Snapshot**

2. **Via API**:
```bash
curl -X POST http://localhost:1880/nmos-matrix/snapshot/save \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Live Show - Camera Setup",
    "description": "Main camera routing for broadcast"
  }'
```

### Exporting a Snapshot

1. **Via Web UI**:
   - Click the **⬇️ Export** button
   - File downloads automatically as `nmos-routing-snapshot-[timestamp].json`

2. **Via Command Line**:
```bash
curl http://localhost:1880/nmos-matrix/snapshot/export \
  -o backup-$(date +%Y%m%d-%H%M%S).json
```

### Importing and Applying a Snapshot

1. **Via Web UI**:
   - Click the **⬆️ Import** button
   - Select your snapshot JSON file
   - Review the preview modal:
     - Check validation results
     - Review routing changes (additions, removals, modifications)
     - Note any invalid routes that will be skipped
   - Click **Apply Snapshot** to restore routing

2. **Via API**:
```bash
# Import and validate
curl -X POST http://localhost:1880/nmos-matrix/snapshot/import \
  -H "Content-Type: application/json" \
  -d @backup-20251102-143045.json

# Apply the validated snapshot
curl -X POST http://localhost:1880/nmos-matrix/snapshot/apply \
  -H "Content-Type: application/json"
```

## Programmatic Usage

### Node.js Script Example

```javascript
const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'http://localhost:1880/nmos-matrix';

// Save current routing as snapshot
async function saveSnapshot(name, description) {
  try {
    const response = await axios.post(`${BASE_URL}/snapshot/save`, {
      name: name,
      description: description
    });
    console.log('Snapshot saved:', response.data.snapshot.name);
    return response.data;
  } catch (error) {
    console.error('Error saving snapshot:', error.message);
  }
}

// Export snapshot to file
async function exportSnapshot(filename) {
  try {
    const response = await axios.get(`${BASE_URL}/snapshot/export`, {
      responseType: 'json'
    });
    fs.writeFileSync(filename, JSON.stringify(response.data, null, 2));
    console.log('Snapshot exported to:', filename);
  } catch (error) {
    console.error('Error exporting snapshot:', error.message);
  }
}

// Import and validate snapshot
async function importSnapshot(filename) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const response = await axios.post(`${BASE_URL}/snapshot/import`, snapshot);
    
    console.log('Snapshot validation results:');
    console.log('- Valid routes:', response.data.validation.validRoutes);
    console.log('- Invalid routes:', response.data.validation.invalidRoutes);
    console.log('- Changes needed:', response.data.validation.changes);
    
    if (response.data.changes && response.data.changes.length > 0) {
      console.log('\nRouting changes:');
      response.data.changes.forEach(change => {
        console.log(`  ${change.type}: ${change.receiverLabel}`);
      });
    }
    
    return response.data;
  } catch (error) {
    console.error('Error importing snapshot:', error.message);
  }
}

// Apply snapshot
async function applySnapshot() {
  try {
    const response = await axios.post(`${BASE_URL}/snapshot/apply`);
    console.log('Snapshot applied:', response.data.message);
    console.log('Total routes:', response.data.totalRoutes);
    return response.data;
  } catch (error) {
    console.error('Error applying snapshot:', error.message);
  }
}

// Usage example
(async () => {
  // Save current state
  await saveSnapshot('Pre-Show Setup', 'Configuration before live event');
  
  // Export for backup
  await exportSnapshot('backup-pre-show.json');
  
  // Later, restore from backup
  await importSnapshot('backup-pre-show.json');
  await applySnapshot();
})();
```

### Python Script Example

```python
import requests
import json
from datetime import datetime

BASE_URL = 'http://localhost:1880/nmos-matrix'

def save_snapshot(name, description=''):
    """Save current routing as snapshot"""
    response = requests.post(f'{BASE_URL}/snapshot/save', json={
        'name': name,
        'description': description
    })
    if response.ok:
        data = response.json()
        print(f"Snapshot saved: {data['snapshot']['name']}")
        return data
    else:
        print(f"Error: {response.status_code}")

def export_snapshot(filename):
    """Export snapshot to file"""
    response = requests.get(f'{BASE_URL}/snapshot/export')
    if response.ok:
        with open(filename, 'w') as f:
            json.dump(response.json(), f, indent=2)
        print(f"Snapshot exported to: {filename}")
    else:
        print(f"Error: {response.status_code}")

def import_and_apply_snapshot(filename):
    """Import and apply snapshot from file"""
    with open(filename, 'r') as f:
        snapshot = json.load(f)
    
    # Import and validate
    response = requests.post(f'{BASE_URL}/snapshot/import', json=snapshot)
    if response.ok:
        data = response.json()
        print(f"Valid routes: {data['validation']['validRoutes']}")
        print(f"Invalid routes: {data['validation']['invalidRoutes']}")
        print(f"Changes: {data['validation']['changes']}")
        
        if data['validation']['changes'] > 0:
            # Apply snapshot
            apply_response = requests.post(f'{BASE_URL}/snapshot/apply')
            if apply_response.ok:
                print("Snapshot applied successfully")
            else:
                print("Error applying snapshot")
    else:
        print(f"Error importing: {response.status_code}")

# Usage
if __name__ == '__main__':
    # Save current configuration
    save_snapshot('Production Setup', 'Main live show configuration')
    
    # Export for backup
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    export_snapshot(f'backup-{timestamp}.json')
    
    # Restore from backup
    import_and_apply_snapshot('backup-20251102-143045.json')
```

## Automation Examples

### Scheduled Backups

Create a cron job to automatically backup routing configuration:

```bash
#!/bin/bash
# /usr/local/bin/nmos-backup.sh

BACKUP_DIR="/backups/nmos-routing"
DATE=$(date +%Y%m%d-%H%M%S)
FILENAME="$BACKUP_DIR/routing-$DATE.json"

mkdir -p "$BACKUP_DIR"

curl -s http://localhost:1880/nmos-matrix/snapshot/export -o "$FILENAME"

if [ $? -eq 0 ]; then
    echo "Backup created: $FILENAME"
    
    # Keep only last 30 backups
    ls -t "$BACKUP_DIR"/routing-*.json | tail -n +31 | xargs -r rm
else
    echo "Backup failed"
    exit 1
fi
```

Crontab entry (backup every 6 hours):
```
0 */6 * * * /usr/local/bin/nmos-backup.sh >> /var/log/nmos-backup.log 2>&1
```

### Pre-Event Setup Script

```bash
#!/bin/bash
# pre-event-setup.sh

echo "Setting up routing for live event..."

# Save current state as backup
echo "Creating pre-event backup..."
curl -X POST http://localhost:1880/nmos-matrix/snapshot/save \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pre-Event Backup",
    "description": "Automatic backup before loading event configuration"
  }'

# Wait a moment
sleep 2

# Import event configuration
echo "Loading event configuration..."
curl -X POST http://localhost:1880/nmos-matrix/snapshot/import \
  -H "Content-Type: application/json" \
  -d @/configs/live-event-setup.json

# Wait for validation
sleep 2

# Apply the configuration
echo "Applying event routing..."
curl -X POST http://localhost:1880/nmos-matrix/snapshot/apply \
  -H "Content-Type: application/json"

echo "Event routing configuration complete!"
echo "Waiting for connections to stabilize (10 seconds)..."
sleep 10

echo "Done! Verify routing at: http://localhost:1880/nmos-matrix"
```

### Node-RED Function Example

Use within Node-RED flows:

```javascript
// In a function node
const snapshotName = msg.payload.eventName || "Auto Snapshot";

// Create snapshot before making changes
msg.payload = {
    name: snapshotName,
    description: "Automatic snapshot before routing change"
};

msg.method = "POST";
msg.url = "http://localhost:1880/nmos-matrix/snapshot/save";

return msg;
```

## Snapshot JSON Format

### Complete Example

```json
{
  "version": "1.0",
  "timestamp": "2025-11-02T13:44:30.123Z",
  "name": "Live Show - Main Configuration",
  "description": "Primary routing setup for live broadcast with cameras, graphics, and monitors",
  "routes": [
    {
      "sender_id": "c4e89e2a-8f7d-4c3b-9f1e-2d3a4b5c6d7e",
      "receiver_id": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "sender_label": "Camera 1 - Main",
      "receiver_label": "Program Monitor",
      "transport_params": {}
    },
    {
      "sender_id": "d5f90e3b-9g8e-5d4c-0g2f-3e4b5c6d7e8f",
      "receiver_id": "b2c3d4e5-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
      "sender_label": "Camera 2 - Wide",
      "receiver_label": "Preview Monitor",
      "transport_params": {}
    },
    {
      "sender_id": "e6g01f4c-0h9f-6e5d-1h3g-4f5c6d7e8f9g",
      "receiver_id": "c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
      "sender_label": "Graphics Engine",
      "receiver_label": "Overlay Mixer",
      "transport_params": {}
    }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | Yes | Snapshot format version (always "1.0") |
| `timestamp` | string | Yes | ISO 8601 timestamp when snapshot was created |
| `name` | string | Yes | Human-readable snapshot name |
| `description` | string | No | Optional detailed description |
| `routes` | array | Yes | Array of route objects |
| `routes[].sender_id` | string | Yes | UUID of the sender |
| `routes[].receiver_id` | string | Yes | UUID of the receiver |
| `routes[].sender_label` | string | Yes | Display name of sender |
| `routes[].receiver_label` | string | Yes | Display name of receiver |
| `routes[].transport_params` | object | No | Transport-specific parameters (reserved) |

## Best Practices

### Naming Conventions

Use clear, descriptive names:
```
✅ Good:
  - "Live Show 2025-11-02 - Morning"
  - "Studio A - Standard Setup"
  - "Pre-Event Backup - 14:30"

❌ Avoid:
  - "test"
  - "snapshot1"
  - "config"
```

### Snapshot Management

1. **Regular Backups**: Export snapshots before major events
2. **Version Control**: Include dates/versions in snapshot names
3. **Documentation**: Use description field to explain routing purpose
4. **Testing**: Test snapshot imports in non-production environment first
5. **Validation**: Always review preview before applying snapshots

### Storage Recommendations

- Keep snapshots in version control (Git)
- Store production snapshots in multiple locations
- Document what each snapshot represents
- Archive old snapshots (don't delete immediately)

### Error Handling

```bash
# Robust snapshot application script
#!/bin/bash

SNAPSHOT_FILE="$1"

if [ ! -f "$SNAPSHOT_FILE" ]; then
    echo "Error: Snapshot file not found: $SNAPSHOT_FILE"
    exit 1
fi

# Import and check validation
VALIDATION=$(curl -s -X POST http://localhost:1880/nmos-matrix/snapshot/import \
  -H "Content-Type: application/json" \
  -d @"$SNAPSHOT_FILE")

INVALID_COUNT=$(echo "$VALIDATION" | jq -r '.validation.invalidRoutes')

if [ "$INVALID_COUNT" -gt 0 ]; then
    echo "Warning: $INVALID_COUNT invalid routes will be skipped"
    echo "$VALIDATION" | jq -r '.invalidRoutes[] | .reason'
    read -p "Continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Apply snapshot
curl -X POST http://localhost:1880/nmos-matrix/snapshot/apply \
  -H "Content-Type: application/json"

echo "Snapshot applied. Check status at: http://localhost:1880/nmos-matrix"
```

## Troubleshooting

### Invalid Routes After Import

**Problem**: Snapshot shows invalid routes when importing

**Causes**:
- Devices removed from NMOS registry
- UUIDs changed
- Different registry being used

**Solution**:
1. Review invalid routes in preview modal
2. Check if devices are still available
3. Edit snapshot JSON to update UUIDs if needed
4. Valid routes will still be applied

### Snapshot Application Fails

**Problem**: Some routes don't apply correctly

**Causes**:
- Network issues
- IS-05 API errors
- Incompatible transport formats

**Solution**:
1. Check Node-RED debug logs
2. Verify IS-05 endpoints are reachable
3. Apply snapshot again (idempotent operation)
4. Manual routing may be needed for failed routes

### Export Returns Empty Routes

**Problem**: Exported snapshot has no routes

**Causes**:
- No active connections in matrix
- Query data not loaded
- Flow context not populated

**Solution**:
1. Verify matrix UI shows connections
2. Click "Refresh" to reload data
3. Wait a few seconds for data to populate
4. Try export again

### Preview Shows No Changes

**Problem**: Import preview shows 0 changes but routing is different

**Causes**:
- Snapshot matches current state
- Routes already applied

**Solution**:
- This is normal if routing already matches
- No action needed

## Examples Repository

Additional snapshot examples and templates:
- [Production Event Templates](https://github.com/DHPKE/nmos-routing-templates)
- [Automation Scripts](https://github.com/DHPKE/nmos-automation)

## Support

For issues or questions:
- GitHub Issues: https://github.com/DHPKE/node-red-contrib-nmos-client/issues
- Documentation: [MATRIX_FLOW.md](MATRIX_FLOW.md)
