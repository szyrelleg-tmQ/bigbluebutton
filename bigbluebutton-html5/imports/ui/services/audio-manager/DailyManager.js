import Daily from '@daily-co/daily-js';

class DailyManager {
    #currentLocalParticipant = null;
    constructor() {
        this.call = null;
        this.isInitialized = false;
        this.eventHandlers = new Map();

        // Audio context and gain nodes
        this.audioContext = null;
        this.gainNodes = new Map(); // participantId -> gainNode
        this.audioElements = new Map(); // participantId -> audioElement
    }

    get CurrentLocalParticipant() {
        return this.#currentLocalParticipant;
    }

    init() {
        if (this.isInitialized) return;

        // Create call object with audio-only settings
        this.call = Daily.createCallObject({
            subscribeToTracksAutomatically: true
        });

        // Initialize audio context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        this.setupEventListeners();
        this.isInitialized = true;
    }

    setupEventListeners() {
        if (!this.call) return;

        this.call.on('joined-meeting', () => {
            this.emitEvent('joined-meeting');
        });

        this.call.on('left-meeting', () => {
            this.emitEvent('left-meeting');
        });

        this.call.on('participant-joined', () => {
            this.emitEvent('participant-joined');
        });

        this.call.on('participant-left', () => {
            this.emitEvent('participant-left');
        });

        this.call.on('participant-updated', () => {
            this.emitEvent('participant-updated');
        });

        // Handle audio tracks
        this.call.on('track-started', (event) => {
            if (event.participant?.local) this.#currentLocalParticipant = event.participant;
            if (event.track && event.track.kind === 'audio' && !event.participant.local) {
                this.createAudioElement(event.participant, event.track);
            }
        });

        this.call.on("app-message", (event) => {
            this.emitEvent('app-message', event);
        });
    }

    isRemoteBot(participant) {
        if (!participant) return false;
        if (participant.user_name.includes('bot-') && !participant.user_name.includes(this.#currentLocalParticipant.user_name)) return true;
        return false;
    }

    async joinRoom(roomUrl, userName, options = {}) {
        try {
            if (!this.isInitialized) {
                this.init();
            }

            console.log('Joining room:', roomUrl);
            await this.call.join({
                url: roomUrl,
                userName: userName || 'User',
                videoSource: false, // Audio only
                audioSource: true   // Enable microphone
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
            if (!this.call) return true;

            await this.call.leave();
            this.emitEvent('left-meeting');
            return true;
        } catch (error) {
            console.error('DailyManager: Error leaving room:', error);
            return false;
        }
    }

    toggleAudio() {
        if (!this.call) return false;
        const newState = !this.call.localAudio();
        this.call.setLocalAudio(newState);
        return newState;
    }

    getParticipants() {
        if (!this.call) return [];
        const participantData = this.call.participants();
        return Object.values(participantData);
    }

    isJoined() {
        if (!this.call) return false;
        return this.call.meetingState() === 'joined-meeting';
    }

    // Event handling
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

    async createAudioElement(participant, track) {
        let gainVolume = 0.5;
        if (this.isRemoteBot(participant)) {
            gainVolume = 0;
        }
        const participantId = participant.session_id;

        this.cleanupParticipantAudio(participantId);

        const stream = new MediaStream([track]);
        const sourceNode = this.audioContext.createMediaStreamSource(stream);
        const gainNode = this.audioContext.createGain();

        gainNode.gain.value = gainVolume;
        sourceNode.connect(gainNode).connect(this.audioContext.destination);

        const audioEl = new Audio();
        audioEl.srcObject = new MediaStream([track]);
        audioEl.style.display = 'none';

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.gainNodes.set(participantId, gainNode);
    }

    async setAudioOutputDevices(outDeviceId) {
        try {
            if (this.audioContext && typeof this.audioContext.setSinkId === 'function') {
                await this.audioContext.setSinkId(outDeviceId);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`🔊 Error setting audio output device:`, error);
            return false;
        }
    }

    async setAudioInputDevices(inDeviceId) {
        try {
            await this.call.setInputDevicesAsync({
                audioDeviceId: inDeviceId,
            });
            return true;
        } catch (error) {
            console.error(`🔊 Error setting audio input device:`, error);
            return false;
        }
    }

    cleanupParticipantAudio(participantId) {
        const existingAudio = this.audioElements.get(participantId);
        if (existingAudio) {
            existingAudio.pause();
            existingAudio.srcObject = null;
            if (existingAudio.parentNode) {
                existingAudio.remove();
            }
            this.audioElements.delete(participantId);
        }

        this.gainNodes.delete(participantId);
    }

    setParticipantVolume(participantId, volume, options = {}) {
        const gainNode = this.gainNodes.get(participantId);
        if (gainNode) {
            const clampedVolume = Math.max(0, Math.min(1, volume));
            const {
                duration = 0.3,
                easing = 'linear',
                startTime = null
            } = options;

            const currentTime = this.audioContext.currentTime;
            const startTimeValue = startTime || currentTime;

            gainNode.gain.cancelScheduledValues(startTimeValue);
            gainNode.gain.setValueAtTime(gainNode.gain.value, startTimeValue);

            if (duration <= 0) {
                gainNode.gain.setValueAtTime(clampedVolume, startTimeValue);
            } else if (easing === 'exponential') {
                const targetValue = clampedVolume === 0 ? 0.0001 : clampedVolume;
                gainNode.gain.exponentialRampToValueAtTime(targetValue, startTimeValue + duration);
                if (clampedVolume === 0) {
                    gainNode.gain.linearRampToValueAtTime(0, startTimeValue + duration + 0.001);
                }
            } else {
                gainNode.gain.linearRampToValueAtTime(clampedVolume, startTimeValue + duration);
            }
        } else {
            console.warn(`❌ No gain node found for participant ${participantId}`);
            console.log(`❌ Available participants:`, Array.from(this.gainNodes.keys()));
        }
    }

    destroy() {
        for (const [participantId] of this.audioElements) {
            this.cleanupParticipantAudio(participantId);
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }

        if (this.call) {
            this.call.destroy();
            this.call = null;
        }
        this.eventHandlers.clear();
        this.isInitialized = false;
    }

    setLanguage(lang) {
        if (this.call) {
            const localParticipantId = this.call.participants()?.local?.session_id;
            this.call.sendAppMessage({
                event_type: 'update_language',
                participant_id: localParticipantId,
                language: lang,
            }, '*');
        }
    }

    setVoice(voiceKey, targetLanguage) {
        if (this.call) {
            this.call.sendAppMessage({
                event_type: 'update_voice',
                voice_key: voiceKey,
                language: targetLanguage,
            }, '*');
        }
    }

    detectLanguage() {
        if (this.call) {
            this.call.sendAppMessage({
                event_type: 'detect_language',
            }, '*');
        }
    }
}

// Create a single instance of the DailyManager
const dailyManagerInstance = new DailyManager();

// Export a function that returns the instance
export function getDailyManager() {
    return dailyManagerInstance;
}