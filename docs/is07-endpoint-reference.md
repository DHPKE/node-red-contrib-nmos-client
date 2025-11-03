# IS-07 Endpoint Quick Reference

## Node Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| **Name** | Display name for the node | IS-07 Endpoint |
| **Registry** | NMOS config node | Required |
| **MQTT Broker** | Broker URL | mqtt://localhost:1883 |
| **Device Label** | Device display name | Node-RED IS-07 Endpoint |
| **Receiver Label** | Receiver resource label | Endpoint Receiver |
| **Subscribe Filter** | MQTT topic pattern | x-nmos/events/1.0/+/+ |
| **QoS Level** | MQTT quality of service | 0 |
| **Send Status Updates** | Enable bidirectional comm | ✓ Enabled |
| **Parse Smartpanel** | Auto-parse commands | ✓ Enabled |

## Input Actions

### Get State
```javascript
msg.payload = { action: "get_state" };
// Returns: configuration, status, statistics
```

### Get Received States
```javascript
msg.payload = { action: "get_received_states" };
// Returns: all received property states
```

### Get Command History
```javascript
msg.payload = { 
    action: "get_command_history",
    limit: 10  // optional
};
// Returns: recent commands with parsed data
```

### Send Status Update
```javascript
msg.payload = {
    action: "send_status",
    path: "tally/red",
    value: true
};
// Publishes status to MQTT
```

### Clear History/States
```javascript
msg.payload = { action: "clear_history" };
msg.payload = { action: "clear_states" };
```

## Output Message Structure

```javascript
{
    topic: "x-nmos/events/1.0/{source-id}/{type}",
    payload: { /* IS-07 grain message */ },
    source_id: "source-uuid",
    flow_id: "flow-uuid",
    endpoint: {
        device_id: "endpoint-device-uuid",
        receiver_id: "endpoint-receiver-uuid"
    },
    smartpanel: {  // Only if parsing enabled
        commands: [ /* parsed commands */ ]
    }
}
```

## Smartpanel Command Patterns

### GPIO/GPI
**Paths**: `gpio/input/N`, `gpi/N`
```javascript
{
    type: "gpio",
    gpio: 1,
    state: true
}
```

### Buttons
**Paths**: `button/N`, `key/N`, `switch/N`
```javascript
{
    type: "button",
    button: 1,
    pressed: true
}
```

### Tally
**Paths**: `tally/red`, `tally/green`, `tally/amber`, `tally/program`, `tally/preview`
```javascript
{
    type: "tally",
    color: "red",
    state: true
}
```

### Faders
**Paths**: `fader/N`, `level/N`, `gain/N`
```javascript
{
    type: "fader",
    fader: 1,
    value: 0.75
}
```

### Encoders
**Paths**: `encoder/N`, `rotary/N`
```javascript
{
    type: "encoder",
    encoder: 1,
    value: 45
}
```

### Generic Property
**Any other path**
```javascript
{
    type: "property",
    path: "custom/path",
    value: "value"
}
```

## Common Use Cases

### React to Button Press
```javascript
// In function node
if (msg.smartpanel && msg.smartpanel.commands) {
    const cmd = msg.smartpanel.commands[0];
    if (cmd.type === 'button' && cmd.pressed) {
        switch(cmd.button) {
            case 1: msg.payload = "Start Recording"; break;
            case 2: msg.payload = "Stop Recording"; break;
            case 3: msg.payload = "Take Snapshot"; break;
        }
        return msg;
    }
}
```

### Control Tally Light
```javascript
// In function node
if (msg.smartpanel && msg.smartpanel.commands) {
    const cmd = msg.smartpanel.commands[0];
    if (cmd.type === 'tally') {
        msg.payload = {
            color: cmd.color,
            state: cmd.state,
            device: "Camera 1"
        };
        return msg;
    }
}
```

### Process Fader Movement
```javascript
// In function node
if (msg.smartpanel && msg.smartpanel.commands) {
    const cmd = msg.smartpanel.commands[0];
    if (cmd.type === 'fader') {
        // Convert to dB: 0.0-1.0 → -60dB to +12dB
        const dbLevel = (cmd.value * 72) - 60;
        msg.payload = {
            fader: cmd.fader,
            level_db: dbLevel.toFixed(1),
            level_percent: (cmd.value * 100).toFixed(0)
        };
        return msg;
    }
}
```

### Send Status Feedback
```javascript
// Send tally confirmation
msg.payload = {
    action: "send_status",
    path: "tally/red/confirmed",
    value: true
};
return msg;
```

## MQTT Topics

### Subscribe (Receiving Events)
Default: `x-nmos/events/1.0/+/+` (all sources, all types)

Specific source: `x-nmos/events/1.0/{source-id}/+`

Specific type: `x-nmos/events/1.0/+/boolean`

### Publish (Status Updates)
`x-nmos/events/1.0/{status-source-id}/object`

## IS-07 Grain Structure

```json
{
  "grain_type": "event",
  "source_id": "uuid",
  "flow_id": "uuid",
  "origin_timestamp": "1705315800:123456789",
  "sync_timestamp": "1705315800:123456789",
  "creation_timestamp": "1705315800:123456789",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event|state",
    "data": [
      {
        "path": "property/path",
        "pre": previous_value,
        "post": new_value
      }
    ]
  }
}
```

## Testing with MQTT CLI

### Subscribe to All Events
```bash
mosquitto_sub -h localhost -t "x-nmos/events/1.0/#" -v
```

### Publish Test Button Event
```bash
mosquitto_pub -h localhost \
  -t "x-nmos/events/1.0/test-source/boolean" \
  -m '{"grain_type":"event","source_id":"test-source","flow_id":"test-flow","origin_timestamp":"1705315800:123456789","sync_timestamp":"1705315800:123456789","creation_timestamp":"1705315800:123456789","rate":{"numerator":0,"denominator":1},"duration":{"numerator":0,"denominator":1},"grain":{"type":"urn:x-nmos:format:data.event","topic":"event","data":[{"path":"button/1","pre":false,"post":true}]}}'
```

### Publish Test Tally Event
```bash
mosquitto_pub -h localhost \
  -t "x-nmos/events/1.0/smartpanel/boolean" \
  -m '{"grain_type":"event","source_id":"smartpanel","flow_id":"flow","origin_timestamp":"1705315800:123456789","sync_timestamp":"1705315800:123456789","creation_timestamp":"1705315800:123456789","rate":{"numerator":0,"denominator":1},"duration":{"numerator":0,"denominator":1},"grain":{"type":"urn:x-nmos:format:data.event","topic":"event","data":[{"path":"tally/red","pre":false,"post":true}]}}'
```

## Node Status Indicators

| Color | Status | Meaning |
|-------|--------|---------|
| 🟢 Green dot | connected | MQTT connected & IS-04 registered |
| 🟡 Yellow dot | mqtt connected | MQTT connected, registration pending |
| 🔴 Red ring | error | Connection or registration error |
| 🔵 Blue dot | registering | Registration in progress |
| 🟡 Yellow ring | offline | MQTT disconnected |

## Troubleshooting Quick Checks

### Not Receiving Events
1. Check MQTT broker is running
2. Verify subscription filter matches topic
3. Test with mosquitto_sub
4. Check Node-RED logs for errors

### Commands Not Parsed
1. Verify "Parse Smartpanel" is enabled
2. Check path format matches patterns
3. Look at raw grain in debug output

### Status Updates Not Working
1. Enable "Send Status Updates"
2. Check MQTT QoS level (use 1 or 2)
3. Verify subscribers are listening
4. Use MQTT Explorer to monitor

### Registration Failed
1. Check registry URL is correct
2. Verify network connectivity
3. Check Node-RED logs for details
4. Test registry with curl

## Links

- **Full Documentation**: [is07-endpoint-smartpanel.md](is07-endpoint-smartpanel.md)
- **Quick Start**: [is07-endpoint-quickstart.md](is07-endpoint-quickstart.md)
- **Testing Guide**: [is07-endpoint-testing.md](is07-endpoint-testing.md)
- **Examples**: `examples/is07-endpoint-smartpanel-example.json`
- **NMOS IS-07 Spec**: [specs.amwa.tv/is-07/](https://specs.amwa.tv/is-07/)
- **GitHub Issues**: [github.com/DHPKE/node-red-contrib-nmos-client/issues](https://github.com/DHPKE/node-red-contrib-nmos-client/issues)

---

**Print this page for quick reference!** 📄
