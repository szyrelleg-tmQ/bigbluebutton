/**
 * @class LatencyAnalyzer
 * @description A utility class to analyze and report latency metrics for bot interactions.
 */
class LatencyAnalyzer {
    constructor(logPrefix = '[LatencyAnalysis]') {
        this.logPrefix = logPrefix;
        // Stores the server timestamp of the last time the local user stopped speaking.
        this.lastUserSpeechEndTimestamp = null;

        // A buffer to store recent latency measurements for calculating aggregates.
        this.measurements = {
            // Measures server-to-client network latency for each message.
            network: [],
            // Measures the perceived time from user speech ending to bot response starting.
            botResponse: [],
        };

        // The maximum number of measurements to store in the buffer.
        this.maxBufferSize = 200;
    }

    /**
     * Records the server-to-client network latency for a received message.
     * NOTE: This metric can be affected by clock skew between the server and client.
     * It is most useful for observing relative changes in network performance.
     * @param {number} serverTimestamp - The timestamp (in ms) from the event data.
     */
    recordNetworkLatency(serverTimestamp) {
        if (!serverTimestamp) return;

        const clientReceiveTime = Date.now();
        const latency = clientReceiveTime - serverTimestamp;

        // Only record plausible, positive latencies.
        if (latency >= 0) {
            this._addToBuffer('network', latency);
            console.log(`${this.logPrefix} Network (Server-to-Client): ${latency}ms`);
        }
    }

    /**
     * Marks the timestamp when the local user has finished speaking.
     * This is the starting point for measuring the bot's response time.
     * @param {number} serverTimestamp - The timestamp (in ms) from the 'user_stopped_speaking' event.
     */
    recordUserSpeechEnd(serverTimestamp) {
        this.lastUserSpeechEndTimestamp = serverTimestamp;
        console.log(`${this.logPrefix} User speech end detected at ${serverTimestamp}. Awaiting bot response.`);
    }

    /**
     * Records the bot's response time if we are currently awaiting it.
     * This should be called when the first translation/transcription from the bot arrives.
     * @param {number} serverTimestamp - The timestamp (in ms) from the translation/bot event.
     */
    recordBotResponseStart(serverTimestamp) {
        // Only calculate if we have a recorded user speech end time.
        if (this.lastUserSpeechEndTimestamp && serverTimestamp > this.lastUserSpeechEndTimestamp) {
            const latency = serverTimestamp - this.lastUserSpeechEndTimestamp;
            this._addToBuffer('botResponse', latency);
            console.log(`${this.logPrefix} Bot Response (End-to-End): ${latency}ms`);

            // Reset the timestamp to prevent recalculating for subsequent message chunks.
            this.lastUserSpeechEndTimestamp = null;
        }
    }

    /**
     * A private helper to add a measurement to the correct buffer, managing its size.
     * @param {'network' | 'botResponse'} type - The type of metric.
     * @param {number} value - The latency value in milliseconds.
     */
    _addToBuffer(type, value) {
        if (!this.measurements[type]) return;

        this.measurements[type].push(value);
        // Evict the oldest measurement if the buffer is full.
        if (this.measurements[type].length > this.maxBufferSize) {
            this.measurements[type].shift();
        }
    }

    /**
     * Calculates and returns aggregate statistics (min, max, average) for a given metric type.
     * @param {'network' | 'botResponse'} type - The type of metric to analyze.
     * @returns {{min: number, max: number, avg: number, count: number} | null}
     */
    getStats(type = 'botResponse') {
        const data = this.measurements[type];
        if (!data || data.length === 0) {
            return { min: 0, max: 0, avg: 0, count: 0 };
        }

        const count = data.length;
        const sum = data.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / count);
        const min = Math.min(...data);
        const max = Math.max(...data);

        return { min, max, avg, count };
    }
}

export default LatencyAnalyzer;