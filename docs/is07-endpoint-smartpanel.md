# NMOS IS-07 Endpoint with RIEDEL Smartpanel Integration

## Overview

The **nmos-is07-endpoint** node provides a complete NMOS endpoint implementation that receives control commands and tally signals via the IS-07 Event & Tally specification. It includes built-in support for RIEDEL Smartpanel hardware control panels, commonly used in broadcast and production environments.

## Features

- **IS-07 Event Subscription**: Receives events from any IS-07 source via MQTT
- **RIEDEL Smartpanel Support**: Automatic parsing of Smartpanel command patterns
- **Bidirectional Communication**: Optionally send status updates back to control sources
- **Command History**: Track and query received commands for monitoring
- **State Management**: Maintain state from multiple event sources
- **IS-04 Registration**: Automatic registration as NMOS receiver in registry

## Architecture

```
┌─────────────────┐         MQTT/IS-07          ┌──────────────────┐
│ RIEDEL          │────────────────────────────>│ nmos-is07-       │
│ Smartpanel      │    Control Commands         │ endpoint         │
│                 │<────────────────────────────│                  │
└─────────────────┘    Status Updates           └──────────────────┘
                                                          │
┌─────────────────┐                                      │
│ Other IS-07     │──────────────────────────────────────┤
│ Sources         │         Event Stream                 │
└─────────────────┘                                      │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │ Node-RED Flows  │
                                                 │ Process Commands│
                                                 └─────────────────┘
```

## Configuration

### Basic Setup

1. **Add nmos-is07-endpoint node** to your Node-RED flow
2. **Configure NMOS Registry**: Select or create an `nmos-config` node pointing to your IS-04 registry
3. **Set MQTT Broker**: Configure the MQTT broker URL (e.g., `mqtt://broker.example.com:1883`)
4. **Configure Device Labels**: Set meaningful names for the endpoint device and receiver

### Configuration Options

#### Device Settings
- **Device Label**: Display name for this endpoint (e.g., "Camera 1 Tally Endpoint")
- **Device Description**: Detailed description of the endpoint purpose
- **Receiver Label**: Label for the IS-07 receiver resource

#### Subscription Configuration
- **Subscribe Filter**: MQTT topic pattern for event subscription
  - Default: `x-nmos/events/1.0/+/+` (all IS-07 events)
  - Single source: `x-nmos/events/1.0/{source-id}/+`
  - Specific event type: `x-nmos/events/1.0/+/boolean`

#### Endpoint Features
- **Send Status Updates**: Enable bidirectional communication to publish status back
- **Parse RIEDEL Smartpanel**: Automatically identify and parse Smartpanel command patterns

#### MQTT Settings
- **QoS Level**: Quality of Service for MQTT messages (0, 1, or 2)
- **MQTT Broker**: Full broker URL with protocol (mqtt://, mqtts://, ws://, wss://)

## RIEDEL Smartpanel Integration

### Overview

RIEDEL Smartpanel is a professional control panel system used in broadcast environments. The integration allows Smartpanel to send control commands via IS-07 events that are automatically parsed and interpreted.

### Supported Command Types

#### 1. GPIO/GPI Inputs
**Path Patterns:**
- `gpio/input/N` - GPIO input port N
- `gpi/N` - GPI port N

**Example Output:**
```json
{
  "type": "gpio",
  "gpio": 1,
  "state": true,
  "raw_path": "gpio/input/1",
  "raw_value": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### 2. Button/Key Presses
**Path Patterns:**
- `button/N` - Button number N
- `key/N` - Key number N
- `switch/N` - Switch number N

**Example Output:**
```json
{
  "type": "button",
  "button": 5,
  "pressed": true,
  "raw_path": "button/5",
  "raw_value": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### 3. Tally Signals
**Path Patterns:**
- `tally/red` - Red tally (program)
- `tally/green` - Green tally (preview)
- `tally/amber` - Amber tally
- `tally/yellow` - Yellow tally
- `tally/program` - Program tally
- `tally/preview` - Preview tally

**Example Output:**
```json
{
  "type": "tally",
  "color": "red",
  "state": true,
  "raw_path": "tally/red",
  "raw_value": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### 4. Faders/Levels
**Path Patterns:**
- `fader/N` - Fader number N
- `level/N` - Level control N
- `gain/N` - Gain control N

**Example Output:**
```json
{
  "type": "fader",
  "fader": 1,
  "value": 0.75,
  "raw_path": "fader/1",
  "raw_value": 0.75,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### 5. Encoders/Rotary Controls
**Path Patterns:**
- `encoder/N` - Encoder number N
- `rotary/N` - Rotary control N

**Example Output:**
```json
{
  "type": "encoder",
  "encoder": 2,
  "value": 45,
  "raw_path": "encoder/2",
  "raw_value": 45,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Smartpanel Configuration

#### Step 1: Configure Smartpanel MQTT Connection
1. Access Smartpanel configuration interface
2. Navigate to **Network Settings** > **MQTT**
3. Set MQTT broker address (same as endpoint configuration)
4. Enable IS-07 event publishing
5. Set QoS level (typically 0 or 1)

#### Step 2: Map Control Elements
Configure each Smartpanel control element to publish IS-07 events:

**Button Mapping Example:**
- Control: Button 1
- Action: Publish MQTT
- Topic: `x-nmos/events/1.0/{smartpanel-source-id}/boolean`
- Path: `button/1`
- Value: `true` on press, `false` on release

**Tally Mapping Example:**
- Control: Tally LED 1 Red
- Source: MQTT Subscribe
- Topic: `x-nmos/events/1.0/{endpoint-status-source-id}/object`
- Path: `tally/red`

#### Step 3: Configure Source IDs
- Note the Smartpanel source UUID from device configuration
- Use this in the endpoint's subscription filter if filtering to specific source
- Configure the endpoint's status source ID for feedback

### Example Smartpanel IS-07 Event Format

**Command from Smartpanel:**
```json
{
  "grain_type": "event",
  "source_id": "a1b2c3d4-1234-5678-90ab-cdef12345678",
  "flow_id": "f1e2d3c4-5678-90ab-cdef-123456789012",
  "origin_timestamp": "1705315800:123456789",
  "sync_timestamp": "1705315800:123456789",
  "creation_timestamp": "1705315800:123456789",
  "rate": { "numerator": 0, "denominator": 1 },
  "duration": { "numerator": 0, "denominator": 1 },
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event",
    "data": [
      {
        "path": "button/3",
        "pre": false,
        "post": true
      }
    ]
  }
}
```

**Parsed Output (with Smartpanel parsing enabled):**
```json
{
  "topic": "x-nmos/events/1.0/a1b2c3d4-1234-5678-90ab-cdef12345678/boolean",
  "payload": { /* full grain message */ },
  "source_id": "a1b2c3d4-1234-5678-90ab-cdef12345678",
  "smartpanel": {
    "commands": [
      {
        "type": "button",
        "button": 3,
        "pressed": true,
        "raw_path": "button/3",
        "raw_value": true,
        "pre_value": false,
        "timestamp": "2024-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

## Node Input Actions

### Get Current State
Query endpoint configuration and status:
```javascript
msg.payload = { action: "get_state" };
```

**Response:**
```json
{
  "nodeId": "uuid",
  "deviceId": "uuid",
  "receiverId": "uuid",
  "statusSourceId": "uuid",
  "registered": true,
  "mqttConnected": true,
  "mqttBroker": "mqtt://localhost:1883",
  "subscriptionFilter": "x-nmos/events/1.0/+/+",
  "receivedSources": ["source-uuid-1", "source-uuid-2"],
  "receivedStatesCount": 42,
  "localState": {},
  "sendStatusUpdates": true,
  "parseSmartpanel": true
}
```

### Get Received States
Query all received property states:
```javascript
msg.payload = { action: "get_received_states" };
```

**Response:**
```json
{
  "states": [
    {
      "source_id": "uuid",
      "path": "tally/red",
      "value": true,
      "pre_value": false,
      "timestamp": "TAI-timestamp"
    }
  ],
  "count": 42,
  "sources": ["source-1", "source-2"]
}
```

### Get Command History
Query recent command history:
```javascript
msg.payload = { 
  action: "get_command_history",
  limit: 20  // optional, default 10
};
```

**Response:**
```json
{
  "history": [
    {
      "timestamp": "ISO-8601-timestamp",
      "source_id": "uuid",
      "topic": "mqtt-topic",
      "grain_type": "event",
      "commands": [ /* parsed Smartpanel commands */ ]
    }
  ],
  "total": 100
}
```

### Send Status Update
Publish status back to sources:
```javascript
msg.payload = {
  action: "send_status",
  path: "status/ready",
  value: true
};
```

### Write to Smartpanel LCD Display
Write text to the Smartpanel LCD screen:
```javascript
// Write text to general LCD display
msg.payload = {
  action: "write_lcd",
  text: "Camera 1 - LIVE"
};

// Write text to specific LCD line
msg.payload = {
  action: "write_lcd",
  text: "Program Feed",
  line: 1  // Line number (1, 2, 3, etc.)
};

// Clear LCD display
msg.payload = {
  action: "write_lcd",
  text: ""
};
```

**Response:**
```json
{
  "success": true,
  "action": "write_lcd",
  "text": "Camera 1 - LIVE",
  "line": "all"
}
```

**LCD Path Patterns:**
- General LCD: `lcd/text` - Writes to the main LCD display
- Specific Line: `lcd/line/N` - Writes to LCD line N (1, 2, 3, etc.)

**Notes:**
- LCD text is published with `retain: true` so new connections see the current display
- The Smartpanel must be subscribed to `x-nmos/events/1.0/{status-source-id}/string`
- Text length may be limited by the Smartpanel hardware (typically 16-20 characters per line)
- Empty text string clears the display

### Clear History/States
Clear tracking data:
```javascript
// Clear command history
msg.payload = { action: "clear_history" };

// Clear received states
msg.payload = { action: "clear_states" };
```

## Node Output Messages

The endpoint outputs messages for every received IS-07 event:

```json
{
  "topic": "x-nmos/events/1.0/{source-id}/{event-type}",
  "payload": {
    // Full IS-07 grain message
  },
  "source_id": "source-uuid",
  "flow_id": "flow-uuid",
  "endpoint": {
    "device_id": "endpoint-device-uuid",
    "receiver_id": "endpoint-receiver-uuid"
  },
  "smartpanel": {  // Only if parsing enabled and patterns matched
    "commands": [
      {
        "type": "button|gpio|tally|fader|encoder|property",
        // Type-specific fields
      }
    ],
    "raw_grain": { /* original grain */ }
  }
}
```

## Bidirectional Communication

When **Send Status Updates** is enabled, the endpoint can publish status back to sources:

1. Configure the endpoint with status updates enabled
2. Use the `send_status` action to publish state changes
3. Sources can subscribe to `x-nmos/events/1.0/{endpoint-status-source-id}/object`
4. Smartpanel receives feedback and updates tally/status indicators

**Example Status Flow:**
```
[Smartpanel] --button press--> [Endpoint] --process--> [Application]
                                                             |
[Smartpanel] <--tally update-- [Endpoint] <--status update---+
```

## Example Flows

### Basic Smartpanel Command Receiver

```json
[
  {
    "id": "endpoint1",
    "type": "nmos-is07-endpoint",
    "name": "Camera 1 Control",
    "registry": "registry-config-id",
    "mqttBroker": "mqtt://broker:1883",
    "deviceLabel": "Camera 1 Tally",
    "parseSmartpanel": true
  },
  {
    "id": "debug1",
    "type": "debug",
    "name": "Show Commands"
  }
]
```
Wire `endpoint1` output to `debug1`.

### Button Press Handler

```javascript
// Function node connected to endpoint output
if (msg.smartpanel && msg.smartpanel.commands) {
    for (const cmd of msg.smartpanel.commands) {
        if (cmd.type === 'button' && cmd.pressed) {
            // Handle button press
            node.warn(`Button ${cmd.button} pressed`);
            
            // Trigger action based on button
            switch(cmd.button) {
                case 1:
                    // Start recording
                    msg.payload = { action: "start_recording" };
                    return msg;
                case 2:
                    // Stop recording
                    msg.payload = { action: "stop_recording" };
                    return msg;
            }
        }
    }
}
```

### Tally Feedback Loop

```javascript
// Function node to send tally feedback
// Triggered by production switcher state change

// Send red tally (program)
msg.payload = {
    action: "send_status",
    path: "tally/red",
    value: true
};

return msg;
```

### Fader Control

```javascript
// Function node to process fader movements
if (msg.smartpanel && msg.smartpanel.commands) {
    for (const cmd of msg.smartpanel.commands) {
        if (cmd.type === 'fader') {
            // Map fader value (0.0-1.0) to audio level
            const dbLevel = (cmd.value * 72) - 60; // -60dB to +12dB
            
            msg.payload = {
                fader: cmd.fader,
                level_db: dbLevel,
                level_normalized: cmd.value
            };
            
            return msg;
        }
    }
}
```

### LCD Display Update

```javascript
// Function node to update Smartpanel LCD based on system state
// Connect this to your system state changes

// Display camera status
msg.payload = {
    action: "write_lcd",
    text: "CAM1 - LIVE",
    line: 1
};

// Display additional info on line 2
msg.payload = {
    action: "write_lcd",
    text: "Program Feed",
    line: 2
};

return msg;
```

### Dynamic LCD Updates

```javascript
// Function node to show dynamic information
// For example, displaying time remaining or current scene

const timeRemaining = flow.get('time_remaining') || "00:00";
const currentScene = flow.get('current_scene') || "Idle";

// Update line 1 with scene name
msg.payload = {
    action: "write_lcd",
    text: currentScene.substring(0, 16), // Limit to 16 chars
    line: 1
};

// Send first message
node.send(msg);

// Update line 2 with time
msg.payload = {
    action: "write_lcd",
    text: `Time: ${timeRemaining}`,
    line: 2
};

return msg;
```

## LCD Display Writing

### Overview

The `write_lcd` action enables writing custom text to the Riedel Smartpanel LCD display. This is particularly useful for Smartpanels that are not routable via IS-05 controls, as it provides a way to communicate status information, program names, and other relevant details directly to panel users.

### Use Cases

1. **Camera Status Display**
   - Show "LIVE", "STANDBY", "RECORDING" status
   - Display current program or scene name
   - Show operator instructions or notes

2. **Production Information**
   - Display time remaining in segment
   - Show current rundown item
   - Display countdown timers

3. **Equipment Status**
   - Show device states (e.g., "Audio OK", "Video Loss")
   - Display error messages or alerts
   - Show connection status

4. **User Guidance**
   - Display instructions for operators
   - Show button mappings or shortcuts
   - Display context-sensitive help

### Technical Details

**MQTT Topic:** The LCD text is published to `x-nmos/events/1.0/{status-source-id}/string`

**IS-07 Grain Structure:**
```json
{
  "grain_type": "event",
  "source_id": "{endpoint-status-source-id}",
  "flow_id": "{receiver-id}",
  "origin_timestamp": "TAI-timestamp",
  "sync_timestamp": "TAI-timestamp",
  "creation_timestamp": "TAI-timestamp",
  "rate": { "numerator": 0, "denominator": 1 },
  "duration": { "numerator": 0, "denominator": 1 },
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "lcd",
    "data": [{
      "path": "lcd/text",  // or "lcd/line/N"
      "pre": null,
      "post": "Your display text"
    }]
  }
}
```

**Smartpanel Configuration:**
1. Configure Smartpanel to subscribe to LCD events
2. Set subscription topic: `x-nmos/events/1.0/{endpoint-status-source-id}/string`
3. Map LCD display to the `lcd/text` or `lcd/line/N` paths
4. The Smartpanel will automatically update the LCD when events are received

### Character Limitations

Most Riedel Smartpanel LCD displays have the following limitations:
- **16-20 characters per line** (varies by model)
- **2-4 lines** (varies by model)
- **ASCII character set** (some models support limited special characters)

**Best Practices:**
- Keep text concise and clear
- Use abbreviations when necessary (e.g., "REC" instead of "Recording")
- Test with your specific Smartpanel model to verify character limits
- Use uppercase for better visibility on small displays

### Example Integration Flow

```javascript
// Monitor system state and update Smartpanel LCD
// This could be triggered by various system events

if (msg.topic === "camera/status") {
    let lcdText = "";
    let line = 1;
    
    switch(msg.payload.state) {
        case "live":
            lcdText = "◉ LIVE ◉";
            break;
        case "preview":
            lcdText = "PREVIEW";
            break;
        case "standby":
            lcdText = "Standby";
            break;
        case "recording":
            lcdText = "● REC";
            break;
        default:
            lcdText = "Ready";
    }
    
    // Send to endpoint
    msg.payload = {
        action: "write_lcd",
        text: lcdText,
        line: line
    };
    
    return msg;
}
```

## Real-World Broadcast Scenarios

### Scenario 1: Multi-Camera Studio with Tally

**Setup:**
- 4 cameras with tally endpoints
- RIEDEL Smartpanel for director control
- Production switcher integration

**Flow:**
1. Switcher sends program/preview state changes
2. Endpoints receive state via IS-07
3. Parse tally commands (red=program, green=preview)
4. Control camera tally lights
5. Feedback camera status to Smartpanel

### Scenario 2: Remote Production Control

**Setup:**
- Distributed production setup
- Smartpanel at control room
- Remote camera operators with endpoints

**Flow:**
1. Director presses Smartpanel buttons
2. Commands sent via IS-07 over WAN
3. Remote endpoints receive and parse commands
4. Trigger camera movements, recording, etc.
5. Status updates sent back to Smartpanel

### Scenario 3: Automated Production Workflow

**Setup:**
- Smartpanel for manual override
- Automated workflow system
- Multiple endpoints for different devices

**Flow:**
1. Automated system sends IS-07 events
2. Smartpanel can override with buttons
3. Endpoints process both sources
4. Priority given to manual controls
5. All actions logged in command history

## Troubleshooting

### Issue: Endpoint not receiving events

**Check:**
1. MQTT broker connectivity (check node status)
2. Subscription filter matches published topics
3. Source is publishing to correct MQTT topics
4. QoS levels match between publisher and subscriber

**Debug:**
```javascript
msg.payload = { action: "get_state" };
// Check mqttConnected and registeredSources
```

### Issue: Smartpanel commands not parsed

**Check:**
1. "Parse RIEDEL Smartpanel" is enabled
2. Event paths follow expected patterns (see command types)
3. Check debug output for raw grain data

**Debug:**
Look at `msg.payload.grain.data` to see raw paths and values.

### Issue: Status updates not received by Smartpanel

**Check:**
1. "Send Status Updates" is enabled
2. Smartpanel is subscribed to endpoint's status source ID
3. Topic pattern matches: `x-nmos/events/1.0/{status-source-id}/object`
4. MQTT broker allows bidirectional communication

**Debug:**
Check MQTT broker logs for published messages.

### Issue: Registration fails

**Check:**
1. NMOS registry is accessible
2. Registry URL is correct in nmos-config
3. Registry API version matches
4. Network connectivity from Node-RED to registry

**Debug:**
Check Node-RED logs for registration error details.

## Best Practices

### 1. Subscription Filtering
- Use specific filters when possible to reduce message traffic
- Filter by source ID if receiving from single Smartpanel
- Filter by event type if only interested in specific types

### 2. Command History Management
- Periodically clear history to prevent memory growth
- Use `get_command_history` with appropriate limits
- Clear history in production during quiet periods

### 3. Status Updates
- Only enable status updates if bidirectional communication needed
- Use meaningful status paths that Smartpanel understands
- Throttle status updates to avoid flooding MQTT broker

### 4. Error Handling
- Monitor node status for connection issues
- Implement fallback behavior for missed commands
- Log critical commands for audit trail

### 5. Testing
- Test with MQTT client tools before deploying
- Simulate Smartpanel with IS-07 event publisher
- Verify all command types are parsed correctly

## Advanced Topics

### Custom Command Parsing

If your Smartpanel uses non-standard paths, you can process raw grain data:

```javascript
// Function node after endpoint
const grain = msg.payload;
if (grain.grain && grain.grain.data) {
    for (const item of grain.grain.data) {
        // Custom parsing logic
        if (item.path.startsWith('custom/')) {
            // Handle custom path
        }
    }
}
```

### Multiple Endpoint Instances

Deploy multiple endpoints for different control zones:

- Camera control endpoint
- Audio control endpoint
- Lighting control endpoint
- Automation control endpoint

Each with specific subscription filters and command parsing.

### Integration with Other Systems

Combine IS-07 endpoint with:
- **nmos-connection**: Route video/audio based on commands
- **nmos-matrix**: Control routing matrix from Smartpanel
- **nmos-is12-control**: Send NCP commands to devices
- External APIs: Trigger external systems via HTTP

## Reference Documentation

- **NMOS IS-07 Specification**: [specs.amwa.tv/is-07/](https://specs.amwa.tv/is-07/)
- **NMOS IS-04 Specification**: [specs.amwa.tv/is-04/](https://specs.amwa.tv/is-04/)
- **MQTT Protocol**: [mqtt.org](https://mqtt.org/)
- **RIEDEL Smartpanel**: [riedel.net/products/smartpanels/](https://www.riedel.net/products/smartpanels/)

## Support

For issues, questions, or feature requests related to the nmos-is07-endpoint node, please open an issue on the [GitHub repository](https://github.com/DHPKE/node-red-contrib-nmos-client).
