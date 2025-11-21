/**
 * GPIO Event Mapper - Maps IS-07 events to GPIO pins
 */
class GPIOMapper {
    constructor(config = {}) {
        this.mapping = config.mapping || {};
        this.states = {};
    }

    mapEvent(eventData) {
        const gpioEvents = [];
        
        for (const [path, gpioPin] of Object.entries(this.mapping)) {
            if (this.matchesPath(eventData, path)) {
                gpioEvents.push({
                    pin: gpioPin,
                    value: this.extractValue(eventData, path),
                    timestamp: Date.now()
                });
            }
        }

        return gpioEvents;
    }

    matchesPath(eventData, path) {
        // Simple path matching - can be enhanced
        return eventData.path && eventData.path.includes(path);
    }

    extractValue(eventData, path) {
        if (eventData.value !== undefined) return eventData.value;
        if (eventData.post !== undefined) return eventData.post;
        return null;
    }
}

module.exports = GPIOMapper;
