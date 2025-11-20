# RIEDEL SmartPanel Integration Guide

This guide explains how to integrate RIEDEL SmartPanel devices with the NMOS IS-07 Endpoint node in Node-RED.

## Overview

The NMOS IS-07 Endpoint node provides comprehensive support for RIEDEL SmartPanel control surfaces, enabling bidirectional communication between SmartPanel devices and Node-RED flows.

## Features

### Supported SmartPanel Controls

1. **LeverKey Up/Down**
   - Physical lever switches that can be moved up or down
   - Emits events with direction (up/down) and state information
   - Path pattern: `leverkey/N/up` or `leverkey/N/down` (also supports `lever/N/up|down`)

2. **Rotary Controls**
   - **RotaryPush**: Press the rotary encoder button
   - **RotaryLeft**: Turn counter-clockwise
   - **RotaryRight**: Turn clockwise
   - Path patterns: `rotary/N/push`, `rotary/N/left`, `rotary/N/right`

3. **Display Text Output**
   - Send text to SmartPanel displays
   - Configurable color (white, green, red, amber)
   - Adjustable brightness (0-100)

4. **Routing Configuration**
   - Configure audio routing for SmartPanel devices
   - Support for bidirectional communication

## Setup

### Prerequisites

1. NMOS Registry (IS-04 compatible)
2. MQTT Broker
3. RIEDEL SmartPanel device configured to publish IS-07 events

### Configuration Steps

1. **Add NMOS Config Node**
   - Configure your NMOS registry URL
   - Set authentication if required

2. **Add IS-07 Endpoint Node**
   - Select the NMOS config node
   - Set MQTT broker URL (e.g., `mqtt://localhost:1883`)
   - Enable "Parse RIEDEL Smartpanel Commands"
   - Configure device and receiver labels

3. **Connect Your Flow**
   - Wire the endpoint output to processing nodes
   - Send control messages back to the endpoint for display updates

## Usage Examples

### Receiving LeverKey Events

```javascript
// In a function node connected to the endpoint output
if (msg.smartpanel && msg.smartpanel.commands) {
    for (const cmd of msg.smartpanel.commands) {
        if (cmd.type === 'leverkey') {
            node.warn(`LeverKey ${cmd.leverkey} moved ${cmd.direction}`);
            node.warn(`State: ${cmd.state}`);
            
            // React to lever position
            if (cmd.direction === 'up') {
                // Do something when lever moved up
            } else if (cmd.direction === 'down') {
                // Do something when lever moved down
            }
        }
    }
}
```

### Receiving Rotary Events

```javascript
// In a function node connected to the endpoint output
if (msg.smartpanel && msg.smartpanel.commands) {
    for (const cmd of msg.smartpanel.commands) {
        if (cmd.type === 'rotary') {
            switch(cmd.action) {
                case 'push':
                    node.warn(`Rotary ${cmd.rotary} pressed`);
                    // Handle button press
                    break;
                case 'left':
                    node.warn(`Rotary ${cmd.rotary} turned left`);
                    // Handle counter-clockwise rotation
                    break;
                case 'right':
                    node.warn(`Rotary ${cmd.rotary} turned right`);
                    // Handle clockwise rotation
                    break;
            }
        }
    }
}
```

### Sending Display Text

```javascript
// Send a message to the endpoint input
msg.payload = {
    action: 'send_display_text',
    displayId: 1,              // Display number (1-based)
    text: 'Hello SmartPanel!', // Text to display
    options: {
        color: 'green',        // white, green, red, amber
        brightness: 100        // 0-100
    }
};
return msg;
```

### Configuring Routing

```javascript
// Configure SmartPanel routing
msg.payload = {
    action: 'configure_smartpanel_routing',
    panelId: 'panel-1',
    routingConfig: {
        source: 'audio-input-1',
        destination: 'audio-output-1',
        mode: 'bidirectional'
    }
};
return msg;
```

### Complete Example Flow

```javascript
// Function node that processes SmartPanel events and updates displays
if (msg.smartpanel && msg.smartpanel.commands) {
    const responses = [];
    
    for (const cmd of msg.smartpanel.commands) {
        if (cmd.type === 'leverkey') {
            // Update display with lever position
            responses.push({
                payload: {
                    action: 'send_display_text',
                    displayId: cmd.leverkey,
                    text: `Lever ${cmd.direction.toUpperCase()}`,
                    options: {
                        color: cmd.direction === 'up' ? 'green' : 'amber',
                        brightness: 100
                    }
                }
            });
        } 
        else if (cmd.type === 'rotary') {
            // Update display with rotary action
            let text = '';
            if (cmd.action === 'push') text = 'SELECTED';
            else if (cmd.action === 'left') text = '◄ LEFT';
            else if (cmd.action === 'right') text = 'RIGHT ►';
            
            responses.push({
                payload: {
                    action: 'send_display_text',
                    displayId: cmd.rotary,
                    text: text,
                    options: { color: 'white' }
                }
            });
        }
    }
    
    // Send all display updates
    return [responses];
}
```

## Message Format

### Output Message Structure

When the endpoint receives SmartPanel events, it outputs messages with this structure:

```javascript
{
    topic: "x-nmos/events/1.0/{source_id}/object",
    payload: {
        // Standard IS-07 grain
        grain_type: "event",
        source_id: "source-uuid",
        flow_id: "flow-uuid",
        grain: {
            type: "urn:x-nmos:format:data.event",
            topic: "control",
            data: [
                {
                    path: "leverkey/1/up",
                    pre: false,
                    post: true
                }
            ]
        }
    },
    smartpanel: {
        commands: [
            {
                type: "leverkey",
                leverkey: 1,
                direction: "up",
                state: true,
                raw_path: "leverkey/1/up",
                raw_value: true,
                timestamp: "2024-01-01T12:00:00.000Z"
            }
        ]
    }
}
```

### Command Types

#### LeverKey Command
```javascript
{
    type: "leverkey",
    leverkey: 1,        // Lever number
    direction: "up",    // "up" or "down"
    state: true,        // Boolean state
    raw_path: "leverkey/1/up",
    raw_value: true,
    timestamp: "..."
}
```

#### Rotary Command
```javascript
{
    type: "rotary",
    rotary: 1,          // Rotary encoder number
    action: "push",     // "push", "left", or "right"
    value: true,        // Value from the event
    raw_path: "rotary/1/push",
    raw_value: true,
    timestamp: "..."
}
```

## SmartPanel Path Patterns

The endpoint automatically recognizes these IS-07 event path patterns:

| Control Type | Path Pattern | Example |
|--------------|--------------|---------|
| LeverKey Up | `leverkey/N/up` or `lever/N/up` | `leverkey/1/up` |
| LeverKey Down | `leverkey/N/down` or `lever/N/down` | `leverkey/2/down` |
| Rotary Push | `rotary/N/push` | `rotary/1/push` |
| Rotary Left | `rotary/N/left` | `rotary/2/left` |
| Rotary Right | `rotary/N/right` | `rotary/3/right` |
| GPIO | `gpio/input/N` or `gpi/N` | `gpio/input/5` |
| Button | `button/N`, `key/N`, `switch/N` | `button/10` |
| Tally | `tally/color` | `tally/red` |
| Fader | `fader/N`, `level/N`, `gain/N` | `fader/1` |

## Troubleshooting

### Events Not Received

1. Check MQTT broker connection
2. Verify subscription filter includes SmartPanel events
3. Ensure "Parse RIEDEL Smartpanel Commands" is enabled
4. Check debug output for raw MQTT messages

### Display Text Not Showing

1. Verify MQTT connection is active
2. Check that "Send Status Updates" is enabled
3. Ensure displayId is correct (1-based numbering)
4. Verify SmartPanel is subscribed to the status topic

### Routing Not Working

1. Confirm panelId matches your SmartPanel configuration
2. Check routingConfig structure
3. Verify MQTT broker is routing messages correctly

## Advanced Configuration

### Custom MQTT Topics

The endpoint publishes status and display updates to:
```
x-nmos/events/1.0/{statusSourceId}/object
```

Subscribe your SmartPanel to this topic to receive display updates.

### Multiple SmartPanels

To integrate multiple SmartPanels:

1. Deploy multiple IS-07 Endpoint nodes
2. Use different device IDs for each
3. Configure distinct subscription filters
4. Or use a single endpoint with filtering in function nodes

### Integration with Routing Matrix

Combine SmartPanel controls with the NMOS Matrix node for visual routing control:

1. Use LeverKey events to trigger routing operations
2. Update SmartPanel displays with routing status
3. Use Rotary controls for navigation
4. Provide visual feedback via tally lights

## Example Flow

An example flow is provided in `examples/smartpanel-integration-example.json` that demonstrates:

- Receiving LeverKey and Rotary events
- Processing control events
- Sending display text updates
- Configuring routing
- Simulating SmartPanel messages for testing

Import this flow in Node-RED to see the integration in action.

## Reference

- **NMOS IS-07**: https://specs.amwa.tv/is-07/
- **RIEDEL SmartPanel**: https://www.riedel.net/products/smartpanels/
- **Node-RED**: https://nodered.org/

## Support

For issues or questions:
1. Check the Node-RED debug panel for error messages
2. Enable detailed logging in the endpoint node
3. Review the command history using the `get_command_history` action
4. Consult the NMOS IS-07 specification for event formatting

## License

This integration follows the same license as the node-red-contrib-nmos-client package (Apache 2.0).
