# IS-07 Endpoint Quick Start Guide

Get started with the NMOS IS-07 Endpoint node in 5 minutes.

## Prerequisites

1. **Node-RED** installed and running
2. **NMOS Registry** (IS-04) accessible
3. **MQTT Broker** running (e.g., Mosquitto, HiveMQ)

## Step 1: Install the Package

```bash
cd ~/.node-red
npm install node-red-contrib-nmos-client
```

Or install via Node-RED Palette Manager.

## Step 2: Configure NMOS Registry

1. Open Node-RED editor
2. Add an **nmos-config** node from the palette
3. Double-click to configure:
   - **Registry URL**: `http://your-registry-ip:8080`
   - **Query API Version**: `v1.3` (or your version)
   - Click **Add** or **Update**

## Step 3: Add IS-07 Endpoint Node

1. Drag **nmos-is07-endpoint** from the NMOS category
2. Double-click to configure:

### Basic Configuration
- **Name**: `Camera 1 Tally` (or your device name)
- **Registry**: Select the nmos-config you created
- **MQTT Broker**: `mqtt://your-broker-ip:1883`
- **Device Label**: `Camera 1 Tally Endpoint`
- **Receiver Label**: `Camera 1 Receiver`

### Subscription
- **Subscribe Filter**: `x-nmos/events/1.0/+/+` (default - receives all IS-07 events)

### Features
- ☑ **Send Status Updates** (enable for bidirectional communication)
- ☑ **Parse RIEDEL Smartpanel Commands** (enable for automatic command parsing)

### MQTT Settings
- **QoS Level**: `1 - At least once` (recommended for control commands)

Click **Done**.

## Step 4: Add Debug Node

1. Drag a **debug** node from the palette
2. Connect the output of the **nmos-is07-endpoint** to the debug node
3. Deploy your flow

## Step 5: Test the Setup

### Check Status
Look at the node status indicator:
- 🟢 **Green dot**: Connected and registered
- 🟡 **Yellow ring**: MQTT connected, registration pending
- 🔴 **Red ring**: Error (check Node-RED logs)

### Send Test Event

Use an MQTT client (like MQTT Explorer or mosquitto_pub) to send a test IS-07 event:

```bash
mosquitto_pub -h localhost -t "x-nmos/events/1.0/test-source-id/boolean" -m '{
  "grain_type": "event",
  "source_id": "test-source-id",
  "flow_id": "test-flow-id",
  "origin_timestamp": "1705315800:123456789",
  "sync_timestamp": "1705315800:123456789",
  "creation_timestamp": "1705315800:123456789",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event",
    "data": [{
      "path": "button/1",
      "pre": false,
      "post": true
    }]
  }
}'
```

You should see the event appear in the debug panel!

## Step 6: Test Smartpanel Command Parsing

Send a Smartpanel-style tally command:

```bash
mosquitto_pub -h localhost -t "x-nmos/events/1.0/smartpanel-source-id/boolean" -m '{
  "grain_type": "event",
  "source_id": "smartpanel-source-id",
  "flow_id": "smartpanel-flow-id",
  "origin_timestamp": "1705315800:123456789",
  "sync_timestamp": "1705315800:123456789",
  "creation_timestamp": "1705315800:123456789",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event",
    "data": [{
      "path": "tally/red",
      "pre": false,
      "post": true
    }]
  }
}'
```

In the debug panel, you should see a message with a `smartpanel` object containing parsed command:

```json
{
  "smartpanel": {
    "commands": [{
      "type": "tally",
      "color": "red",
      "state": true,
      "raw_path": "tally/red",
      "raw_value": true
    }]
  }
}
```

## Common Use Cases

### Use Case 1: React to Button Press

Add a **switch** node after the endpoint:

- **Property**: `msg.smartpanel.commands[0].type`
- **Rules**: `== button`

Then add a **function** node to handle the button:

```javascript
const cmd = msg.smartpanel.commands[0];
if (cmd.pressed) {
    msg.payload = {
        button: cmd.button,
        action: `Button ${cmd.button} pressed`
    };
    return msg;
}
```

### Use Case 2: Control Tally Light

Add a **function** node after the endpoint:

```javascript
if (msg.smartpanel && msg.smartpanel.commands) {
    const cmd = msg.smartpanel.commands[0];
    
    if (cmd.type === 'tally') {
        // Control physical tally light
        msg.payload = {
            color: cmd.color,
            state: cmd.state
        };
        
        // Send to GPIO, HTTP endpoint, etc.
        return msg;
    }
}
```

### Use Case 3: Send Status Feedback

Add an **inject** node configured to send a message to the endpoint:

```javascript
msg.payload = {
    action: "send_status",
    path: "tally/red/confirmed",
    value: true
};
```

Wire it to the endpoint node. This will publish status back via MQTT.

## Import Example Flow

1. Go to Menu → Import
2. Select **Examples** tab
3. Navigate to **node-red-contrib-nmos-client**
4. Select **is07-endpoint-smartpanel-example.json**
5. Click **Import**
6. Configure the registry and MQTT settings
7. Deploy

The example flow includes:
- Basic endpoint setup
- Smartpanel command processing
- Tally feedback loop
- Multi-camera production scenario

## Troubleshooting

### Problem: Node shows red ring

**Solution:**
1. Check NMOS registry is accessible
2. Verify MQTT broker is running
3. Check Node-RED logs for errors

### Problem: No events received

**Solution:**
1. Verify MQTT broker connectivity
2. Check subscription filter matches published topics
3. Use MQTT Explorer to monitor broker traffic
4. Confirm source is publishing to `x-nmos/events/1.0/...`

### Problem: Commands not parsed

**Solution:**
1. Ensure "Parse RIEDEL Smartpanel" is enabled
2. Check event path format (e.g., `button/N`, `tally/red`)
3. Look at raw grain data in `msg.payload.grain.data`

### Problem: Status updates not working

**Solution:**
1. Verify "Send Status Updates" is enabled
2. Check MQTT QoS level (use 1 or 2 for reliability)
3. Confirm subscribers are listening to correct topic pattern
4. Use MQTT Explorer to verify published messages

## Next Steps

- Read the [complete documentation](is07-endpoint-smartpanel.md)
- Configure your RIEDEL Smartpanel to publish IS-07 events
- Build production flows with tally control
- Integrate with other NMOS nodes (matrix, connection, etc.)

## Getting Help

- **Documentation**: [docs/is07-endpoint-smartpanel.md](is07-endpoint-smartpanel.md)
- **Examples**: Check `examples/is07-endpoint-smartpanel-example.json`
- **Issues**: [GitHub Issues](https://github.com/DHPKE/node-red-contrib-nmos-client/issues)
- **NMOS Specs**: [specs.amwa.tv/is-07/](https://specs.amwa.tv/is-07/)

---

**Happy controlling!** 🎬📹
