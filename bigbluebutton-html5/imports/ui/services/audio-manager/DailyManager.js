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
            // console.log(`🎵 Track started event:`, event);
            // console.log(`🎵 Track kind:`, event.track?.kind);
            // console.log(`🎵 Participant local:`, event.participant?.local);
            if (event.participant?.local) this.#currentLocalParticipant = event.participant;
            if (event.track && event.track.kind === 'audio' && !event.participant.local) {
                // if (this.isRemoteBot(event.participant)) return;
                this.createAudioElement(event.participant, event.track);
            } else {
                // console.log(`❌ Skipping track - not remote audio`);
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

            // let url = roomUrl.trim();
            // if (!url.startsWith('https://')) {
            //     url = `https://jomel.daily.co/${url}`;
            // }
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

        // Clean up existing audio for this participant
        this.cleanupParticipantAudio(participantId);

        // Create audio processing pipeline
        const stream = new MediaStream([track]);

        const sourceNode = this.audioContext.createMediaStreamSource(stream);
        const gainNode = this.audioContext.createGain();

        // Set initial gain value
        gainNode.gain.value = gainVolume;

        // Connect: source → gain → audioContext.destination (NOT MediaStreamDestination)
        sourceNode.connect(gainNode).connect(this.audioContext.destination);

        // Create audio element for autoplay handling (using original stream)
        const audioEl = new Audio();
        audioEl.srcObject = new MediaStream([track]); // Original stream for autoplay
        // audioEl.autoplay = true;
        // audioEl.playsInline = true;
        // audioEl.muted = true;
        // audioEl.setAttribute('data-participant-id', participantId);
        // audioEl.setAttribute('data-participant-type', 'remote');
        // audioEl.setAttribute('data-participant-name', participant.user_name);
        // audioEl.setAttribute('data-audio-context', 'true');
        // audioEl.setAttribute('data-volume', '0.5');
        audioEl.style.display = 'none';

        // Make sure audio context is running
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // Handle autoplay restrictions
        // audioEl.play().catch(err => {
        //     console.warn('❌ Audio autoplay failed, will retry on user interaction:', err);
        // });

        // Store references
        this.gainNodes.set(participantId, gainNode);
        // this.audioElements.set(participantId, audioEl);

        // document.body.appendChild(audioEl);
    }

    async setAudioOutputDevices(outDeviceId) {
        try {
            this.audioContext.setSinkId(outDeviceId);
            return true;
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
        // Remove existing audio element
        const existingAudio = this.audioElements.get(participantId);
        if (existingAudio) {
            existingAudio.pause();
            existingAudio.srcObject = null;
            if (existingAudio.parentNode) {
                existingAudio.remove();
            }
            this.audioElements.delete(participantId);
        }

        // Remove gain node reference
        this.gainNodes.delete(participantId);
    }

    setParticipantVolume(participantId, volume, options = {
        duration: 0.3, // Default fade duration in seconds
        easing: 'linear', // 'linear' or 'exponential'
        startTime: null // Optional start time (uses currentTime if null)
    }) {
        const gainNode = this.gainNodes.get(participantId);
        // if (gainNode) {
        //     gainNode.gain.value = Math.max(0, Math.min(1, volume));
        if (gainNode) {
            const clampedVolume = Math.max(0, Math.min(1, volume));

            // Default options for smooth transitions
            const {
                duration = 0.3, // Default fade duration in seconds
                easing = 'linear', // 'linear' or 'exponential'
                startTime = null // Optional start time (uses currentTime if null)
            } = options;

            const currentTime = this.audioContext.currentTime;
            const startTimeValue = startTime || currentTime;

            gainNode.gain.cancelScheduledValues(startTimeValue);
            gainNode.gain.setValueAtTime(gainNode.gain.value, startTimeValue);

            if (duration <= 0) {
                // Instant volume change
                gainNode.gain.setValueAtTime(clampedVolume, startTimeValue);
            } else {
                if (easing === 'exponential') {
                    // Exponential ramp (cannot go to 0 directly)
                    const targetValue = clampedVolume === 0 ? 0.0001 : clampedVolume;
                    gainNode.gain.exponentialRampToValueAtTime(targetValue, startTimeValue + duration);
                    if (clampedVolume === 0) {
                        gainNode.gain.linearRampToValueAtTime(0, startTimeValue + duration + 0.001);
                    }
                } else {
                    // Linear ramp (default)
                    gainNode.gain.linearRampToValueAtTime(clampedVolume, startTimeValue + duration);
                }
            }
        } else {
            console.warn(`❌ No gain node found for participant ${participantId}`);
            console.log(`❌ Available participants:`, Array.from(this.gainNodes.keys()));
        }
    }


    // setParticipantVolume(participantId, volume, options = {
    //     duration: 0.3, // Default fade duration in seconds
    //     easing: 'linear', // 'linear' or 'exponential'
    //     startTime: null // Optional start time (uses currentTime if null)
    // }) {
    //     const gainNode = this.gainNodes.get(participantId);
    //     // if (gainNode) {
    //     //     gainNode.gain.value = Math.max(0, Math.min(1, volume));
    //     if (gainNode) {
    //         const clampedVolume = Math.max(0, Math.min(1, volume));

    //         // Default options for smooth transitions
    //         const {
    //             duration = 0.3, // Default fade duration in seconds
    //             easing = 'linear', // 'linear' or 'exponential'
    //             startTime = null // Optional start time (uses currentTime if null)
    //         } = options;

    //         const currentTime = this.audioContext.currentTime;
    //         const startTimeValue = startTime || currentTime;

    //         gainNode.gain.cancelScheduledValues(startTimeValue);
    //         gainNode.gain.setValueAtTime(gainNode.gain.value, startTimeValue);

    //         if (duration <= 0) {
    //             // Instant volume change
    //             gainNode.gain.setValueAtTime(clampedVolume, startTimeValue);
    //         } else {
    //             if (easing === 'exponential') {
    //                 // Exponential ramp (cannot go to 0 directly)
    //                 const targetValue = clampedVolume === 0 ? 0.0001 : clampedVolume;
    //                 gainNode.gain.exponentialRampToValueAtTime(targetValue, startTimeValue + duration);
    //                 if (clampedVolume === 0) {
    //                     gainNode.gain.linearRampToValueAtTime(0, startTimeValue + duration + 0.001);
    //                 }
    //             } else {
    //                 // Linear ramp (default)
    //                 gainNode.gain.linearRampToValueAtTime(clampedVolume, startTimeValue + duration);
    //             }
    //         }
    //     } else {
    //         console.warn(`❌ No gain node found for participant ${participantId}`);
    //         console.log(`❌ Available participants:`, Array.from(this.gainNodes.keys()));
    //     }
    // }

    destroy() {
        // Clean up all audio elements
        for (const [participantId] of this.audioElements) {
            this.cleanupParticipantAudio(participantId);
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }

        if (this.call) {
            // This is the call that removes the iframe from the DOM.
            this.call.destroy();
            // *** ADD THIS LINE for extra safety ***
            this.call = null;
        }
        this.eventHandlers.clear();
        this.isInitialized = false;
    }

    setLanguage(lang) {
        if (this.call) {
            // Get local participant's session_id
            const participants = this.call.participants();
            const localParticipantId = participants?.local?.session_id;
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

export default DailyManager;