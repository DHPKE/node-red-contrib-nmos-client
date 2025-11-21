/**
 * Tally Aggregator - Combines multiple tally sources with priority
 */
class TallyAggregator {
    constructor() {
        this.sources = new Map();
        this.priorities = {
            'red': 3,
            'yellow': 2,
            'green': 1
        };
    }

    update(sourceId, state) {
        this.sources.set(sourceId, state);
    }

    remove(sourceId) {
        this.sources.delete(sourceId);
    }

    getAggregatedState() {
        let highestPriority = 0;
        let result = { red: false, yellow: false, green: false };

        for (const [sourceId, state] of this.sources) {
            if (state.red && this.priorities.red > highestPriority) {
                result = { red: true, yellow: false, green: false };
                highestPriority = this.priorities.red;
            } else if (state.yellow && this.priorities.yellow > highestPriority) {
                result = { red: false, yellow: true, green: false };
                highestPriority = this.priorities.yellow;
            } else if (state.green && this.priorities.green > highestPriority) {
                result = { red: false, yellow: false, green: true };
                highestPriority = this.priorities.green;
            }
        }

        return result;
    }
}

module.exports = TallyAggregator;
