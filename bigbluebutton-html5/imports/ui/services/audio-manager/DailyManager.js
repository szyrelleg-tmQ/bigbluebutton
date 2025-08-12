import Daily from '@daily-co/daily-js';

class DailyManager {
    #currentLocalParticipant = null;
    constructor() {
        this.call = null;
        this.isInitialized = false;
        this.eventHandlers = new Map();
        this.audioContext = null;
        this.gainNodes = new Map(); // participantId -> gainNode
        this.audioElements = new Map(); // participantId -> audioElement

        console.log("DailyManager instance created.");
    }

    get CurrentLocalParticipant() {
        return this.#currentLocalParticipant;
    }

    init() {
        if (this.isInitialized) return;

        this.call = Daily.createCallObject({
            subscribeToTracksAutomatically: true,
        });

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.setupEventListeners();
        this.isInitialized = true;
    }

    setupEventListeners() {
        if (!this.call) return;

        this.call.on('joined-meeting', (event) => this.emitEvent('joined-meeting', event));
        this.call.on('left-meeting', (event) => this.emitEvent('left-meeting', event));
        this.call.on('participant-joined', (event) => this.emitEvent('participant-joined', event));
        this.call.on('participant-left', (event) => this.emitEvent('participant-left', event));
        this.call.on('participant-updated', (event) => this.emitEvent('participant-updated', event));
        this.call.on('app-message', (event) => this.emitEvent('app-message', event));

        this.call.on('track-started', (event) => {
            if (event.participant?.local) {
                this.#currentLocalParticipant = event.participant;
            }
            if (event.track?.kind === 'audio' && !event.participant?.local) {
                this.createAudioElement(event.participant, event.track);
            }
        });
    }

    async joinRoom(roomUrl, userName) {
        try {
            if (!this.isInitialized) {
                this.init();
            }
            console.log('DailyManager: Joining room:', roomUrl);
            await this.call.join({
                url: roomUrl,
                userName: userName || 'User',
                videoSource: false,
                audioSource: true,
            });
            return true;
        } catch (error) {
            console.error('DailyManager: Error joining room:', error);
            this.emitEvent('error', { error: error.message });
            return false;
        }
    }

    async leaveRoom() {
        try {
            if (!this.call || this.call.meetingState() === 'left-meeting') return true;
            await this.call.leave();
            console.log("DailyManager: Left room.");
            return true;
        } catch (error) {
            console.error('DailyManager: Error leaving room:', error);
            return false;
        }
    }

    toggleAudio(shouldEnable) {
        if (!this.call) return false;
        const newState = typeof shouldEnable === 'boolean' ? shouldEnable : !this.call.localAudio();
        this.call.setLocalAudio(newState);
        return newState;
    }

    getParticipants() {
        if (!this.call) return [];
        return Object.values(this.call.participants());
    }

    isJoined() {
        if (!this.call) return false;
        return this.call.meetingState() === 'joined-meeting';
    }

    on(eventName, handler) {
        if (!this.eventHandlers.has(eventName)) {
            this.eventHandlers.set(eventName, []);
        }
        this.eventHandlers.get(eventName).push(handler);
    }

    off(eventName, handler) {
        if (!this.eventHandlers.has(eventName)) return;
        const handlers = this.eventHandlers.get(eventName);
        const index = handlers.indexOf(handler);
        if (index > -1) {
            handlers.splice(index, 1);
        }
    }

    emitEvent(eventName, data) {
        if (!this.eventHandlers.has(eventName)) return;
        this.eventHandlers.get(eventName).forEach(handler => {
            try {
                handler(data);
            } catch (error) {
                console.error(`DailyManager: Error in event handler for ${eventName}:`, error);
            }
        });
    }

    createAudioElement(participant, track) {
        const participantId = participant.session_id;
        this.cleanupParticipantAudio(participantId);

        const stream = new MediaStream([track]);
        const sourceNode = this.audioContext.createMediaStreamSource(stream);
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0.5; // Default volume
        sourceNode.connect(gainNode).connect(this.audioContext.destination);

        const audioEl = new Audio();
        audioEl.srcObject = stream;
        audioEl.style.display = 'none';
        document.body.appendChild(audioEl);
        audioEl.play().catch(err => console.warn('Audio autoplay failed:', err));

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.gainNodes.set(participantId, gainNode);
        this.audioElements.set(participantId, audioEl);
    }

    async setAudioInputDevices(inDeviceId) {
        try {
            if (this.call) await this.call.setInputDevicesAsync({ audioDeviceId: inDeviceId });
            return true;
        } catch (error) {
            console.error(`🔊 Error setting audio input device:`, error);
            return false;
        }
    }

    async setAudioOutputDevices(outDeviceId) {
        try {
            if (this.call) await this.call.setOutputDeviceAsync({ outputDeviceId: outDeviceId });
            return true;
        } catch (error) {
            console.error(`🔊 Error setting audio output device:`, error);
            return false;
        }
    }

    cleanupParticipantAudio(participantId) {
        const existingAudio = this.audioElements.get(participantId);
        if (existingAudio) {
            existingAudio.pause();
            existingAudio.srcObject = null;
            existingAudio.remove();
            this.audioElements.delete(participantId);
        }
        this.gainNodes.delete(participantId);
    }

    setParticipantVolume(participantId, volume) {
        const gainNode = this.gainNodes.get(participantId);
        if (gainNode) {
            const clampedVolume = Math.max(0, Math.min(1, volume));
            gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(clampedVolume, this.audioContext.currentTime + 0.1);
        } else {
            // console.warn(`❌ No gain node for participant ${participantId}`);
        }
    }

    destroy() {
        console.log("Destroying DailyManager instance...");
        if (this.call) {
            this.call.destroy();
            this.call = null;
        }
        for (const participantId of this.audioElements.keys()) {
            this.cleanupParticipantAudio(participantId);
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        this.eventHandlers.clear();
        this.isInitialized = false;
        if (window.__dailyManagerInstance) {
            window.__dailyManagerInstance = null;
        }
    }

    setLanguage(lang) {
        if (!this.call) return;
        this.call.sendAppMessage({ event_type: 'update_language', language: lang }, '*');
    }

    setVoice(voiceKey, targetLanguage) {
        if (!this.call) return;
        this.call.sendAppMessage({ event_type: 'update_voice', voice_key: voiceKey, language: targetLanguage }, '*');
    }
}

/**
 * Returns the single instance of the DailyManager.
 * Caches the instance on the window object to prevent duplicates.
 */
export function getDailyManager() {
    if (!window.__dailyManagerInstance) {
        window.__dailyManagerInstance = new DailyManager();
    }
    return window.__dailyManagerInstance;
}