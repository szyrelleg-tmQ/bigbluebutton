/**
 * @class LatencyAnalyzer
 * @description A utility class to analyze and report latency metrics for bot interactions.
 * It calculates and logs two primary metrics:
 * 1. Network Latency: The server-to-client transit time for messages.
 * 2. Bot Response Latency: The end-to-end time from when a user stops
 *    speaking to when the first corresponding translation is received.
 */
class LatencyAnalyzer {
    /**
     * @param {string} [logPrefix='[Latency]'] - A prefix for console log output.
     */
    constructor(logPrefix = '[Latency]') {
        this.logPrefix = logPrefix;

        // Stores the server timestamp of the last time the local user stopped speaking.
        this.lastUserSpeechEndTimestamp = null;

        // A buffer to store recent latency measurements for calculating aggregates.
        this.measurements = {
            network: [],      // Stores server-to-client network latencies.
            botResponse: [],  // Stores end-to-end bot response latencies.
        };

        // The maximum number of measurements to store in the buffer.
        this.maxBufferSize = 200;
    }

    /**
     * Records and logs the server-to-client network latency for a received message.
     * @param {number} serverTimestamp - The timestamp (in milliseconds) from the event data.
     */
    recordNetworkLatency(serverTimestamp) {
        if (typeof serverTimestamp !== 'number') return;

        const clientReceiveTime = Date.now();
        const latency = clientReceiveTime - serverTimestamp;

        // Only record and log plausible, positive latencies.
        if (latency >= 0) {
            this._addToBuffer('network', latency);
            console.log(`${this.logPrefix} Network (Server-to-Client): ${latency}ms`);
        }
    }

    /**
     * Marks the timestamp when the local user has finished speaking.
     * This is called upon receiving the 'user_stopped_speaking' event and does not log anything.
     * @param {number} serverTimestamp - The timestamp from the event data.
     */
    recordUserSpeechEnd(serverTimestamp) {
        if (typeof serverTimestamp !== 'number') return;
        this.lastUserSpeechEndTimestamp = serverTimestamp;
    }

    /**
     * Records and logs the bot's response latency.
     * This should be called when the first translation from the bot arrives after
     * the user has finished speaking.
     * @param {number} serverTimestamp - The timestamp from the translation or bot event.
     */
    recordBotResponseStart(serverTimestamp) {
        // Only calculate if a user speech end time has been recorded and the current
        // event is chronologically after it.
        if (this.lastUserSpeechEndTimestamp && serverTimestamp > this.lastUserSpeechEndTimestamp) {
            const latency = serverTimestamp - this.lastUserSpeechEndTimestamp;
            this._addToBuffer('botResponse', latency);
            console.log(`${this.logPrefix} Bot Response (End-to-End): ${latency}ms`);

            // Reset the timestamp to prevent recalculating for subsequent message chunks
            // from the same user utterance.
            this.lastUserSpeechEndTimestamp = null;
        }
    }

    /**
     * A private helper to add a measurement to the correct buffer while managing its size.
     * @param {'network' | 'botResponse'} type - The type of metric.
     * @param {number} value - The latency value in milliseconds.
     */
    _addToBuffer(type, value) {
        if (!this.measurements[type]) return;

        this.measurements[type].push(value);
        // Evict the oldest measurement if the buffer exceeds its maximum size.
        if (this.measurements[type].length > this.maxBufferSize) {
            this.measurements[type].shift();
        }
    }

    /**
     * Calculates and returns aggregate statistics (min, max, average, count) for a metric.
     * This method does not log to the console.
     * @param {'network' | 'botResponse'} type - The type of metric to analyze.
     * @returns {{min: number, max: number, avg: number, count: number}}
     */
    getStats(type) {
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