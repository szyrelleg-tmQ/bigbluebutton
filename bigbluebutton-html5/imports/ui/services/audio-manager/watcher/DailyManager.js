import Daily from '@daily-co/daily-js';
import EventManager, { EVENTS } from "./Events.js";

class DailyManager {
    constructor() {
        this.call = null;
        this.isInitialized = false;
        this.currentRoomUrl = null;
        this.participants = new Map();
        this.eventHandlers = new Map();

        // Audio context and gain nodes
        this.audioContext = null;
        /**
         * @type {Map<string, GainNode>}
         */
        this.gainNodes = new Map(); // participantId -> gainNode
        /**
         * @type {Map<string, HTMLAudioElement>}
         */
        this.audioElements = new Map(); // participantId -> audioElement
        this.clientSettings = {};
        // EventManager.setDebugCallback((event, data) => {
        //     console.table(data, ["isPlaying", "volume", "isIframe", "event"]);
        // });
        this.init();
        this.setupP2PHandling();
    }

    setClientSettings(clientSettings) {
        this.clientSettings = clientSettings;
    }

    setupP2PHandling() {
        this.call.on('p2p-message', (event) => {
            this.handleP2PMessage(event.message, event.senderId);
        });
    }
    setIframeCallObject(iframe) {
        const config = {
            strictMode: false,
            dailyConfig: {
                experimentalChromeVideoMuteLightOff: true,
                avoidEval: true,
            }
        };
        if (typeof iframe === HTMLIFrameElement) {
            this.call = Daily.wrap(iframe, config);
        }
    }

    init() {
        // Create call object with strict no-video settings
        this.call = Daily.createCallObject({
            strictMode: false,
            dailyConfig: {
                experimentalChromeVideoMuteLightOff: true,
                avoidEval: true,
            }
        });

        // Initialize audio context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Immediately set video to false
        this.call.setLocalVideo(false);

        this.setupEventListeners();
        this.isInitialized = true;
    }

    setupEventListeners() {
        if (!this.call) return;

        this.call.on('joined-meeting', this.handleJoinedMeeting.bind(this));
        this.call.on('left-meeting', this.handleLeftMeeting.bind(this));
        this.call.on('participant-joined', this.handleParticipantJoined.bind(this));
        this.call.on('participant-left', this.handleParticipantLeft.bind(this));
        this.call.on('participant-updated', this.handleParticipantUpdated.bind(this));
        this.call.on('active-speaker-change', this.handleActiveSpeakerChange.bind(this));
        this.call.on('error', this.handleError.bind(this));
        this.call.on("app-message", this.handleAppMessage.bind(this));
    }

    async joinRoom(roomUrl, userName) {
        try {
            if (!this.isInitialized) {
                this.init();
            }

            this.currentRoomUrl = roomUrl;

            // Build join options correctly for Daily.co
            const joinOptions = {
                url: roomUrl,
                userName: userName,
                videoSource: false,
                // audioSource: { echoCancellation: true, noiseSuppression: true },
                startVideoOff: true,
                // inputSettings: {
                //     audio: { processor: { type: 'noise-cancellation' } }
                // }
            };

            await this.call.join(joinOptions);

            // Immediately disable all video
            await this.call.setLocalVideo(false);

            // Disable automatic track subscriptions FIRST
            try {
                await this.call.setSubscribeToTracksAutomatically(false);
            } catch (err) {
                console.warn('Could not disable automatic subscriptions:', err);
            }

            // Update all existing participants to audio-only AFTER disabling auto-subscribe
            const participants = this.call.participants();
            for (const [id, participant] of Object.entries(participants)) {
                if (!participant.local) {
                    try {
                        await this.call.updateParticipant(id, {
                            setSubscribedTracks: {
                                audio: true,
                                video: false,
                                screenVideo: false,
                                screenAudio: false
                            }
                        });
                    } catch (err) {
                        console.warn(`Failed to update participant ${id} tracks:`, err);
                    }
                }
            }

            this.emitEvent('room-joined', { roomUrl });
            return true;
        } catch (error) {
            console.error('DailyManager: Error joining room:', error);
            this.emitEvent('room-error', { error: error.message });
            return false;
        }
    }

    async leaveRoom() {
        try {
            if (!this.call) return true;

            // Clean up all audio elements
            this.cleanupAllAudio();

            await this.call.leave();
            // this.participants.clear();
            // this.currentRoomUrl = null;
            this.destroy();
            this.emitEvent('room-left', {});
            return true;
        } catch (error) {
            console.error('DailyManager: Error leaving room:', error);
            return false;
        }
    }

    isAudioElementExists(participantId) {
        const audioElements = document.querySelectorAll(`audio[data-participant-id="${participantId}"]`);
        return audioElements.length > 0;
    }

    createAudioElementWithGain(participant) {
        if (participant.local) return null;
        const participantId = participant.session_id;
        const audioTrack = participant.tracks?.audio?.persistentTrack || participant.tracks?.audio?.track;

        if (this.isAudioElementExists(participantId)) {
            return null;
        }

        if (!audioTrack) {
            console.warn(`No audio track for participant ${participant.user_name}`);
            return null;
        }

        try {
            // Clean up existing audio for this participant
            this.cleanupParticipantAudio(participantId);

            // Create audio processing pipeline
            const stream = new MediaStream([audioTrack]);
            const sourceNode = this.audioContext.createMediaStreamSource(stream);
            const gainNode = this.audioContext.createGain();
            const destination = this.audioContext.createMediaStreamDestination();

            // Determine participant type and set appropriate gain
            let participantType = 'remote';
            // #NOTES: Raw audio volume, FETCH from database and static for now for testing (field:human_volume)
            let gainValue = this.clientSettings?.human_volume || 0.1; // Default for remote users

            // Get current user name - check multiple sources
            const urlParams = new URLSearchParams(window.location.search);
            const urlParticipantName = urlParams.get('participantName');

            // Find the local participant to get the actual username
            let currentUserName = null;
            if (participant.local) {
                currentUserName = participant.user_name;
            } else {
                // Find local participant in the call
                const participants = this.call.participants();
                const localParticipant = Object.values(participants).find(p => p.local);
                currentUserName = localParticipant?.user_name || urlParticipantName;
            }

            if (participant.local) {
                participantType = 'local';
                // #NOTES: Raw audio volume, FETCH from database and static for now for testing (field: human_volume)
                gainValue = this.clientSettings?.human_volume || 0.1;
            } else if (participant.user_name && participant.user_name.startsWith('bot-')) {
                const botNameWithoutPrefix = participant.user_name.replace('bot-', '');

                // Check if this bot belongs to the current user
                // The bot name format is: bot-{username}-{uuid}
                // So we need to check if the bot name starts with our username
                if (currentUserName && botNameWithoutPrefix.startsWith(currentUserName)) {
                    participantType = 'bot-local';
                    // #NOTES: Bot local audio volume, FETCH from database and static for now for testing (field: bot_volume)
                    gainValue = this.clientSettings?.bot_volume || 1.0;
                } else {
                    participantType = 'bot-remote';
                    gainValue = 0;
                }
            } else {
                // Regular remote participant
                participantType = 'remote';
                gainValue = this.clientSettings?.human_volume || 0.1;
            }

            gainNode.gain.value = gainValue;

            // connect graph: source → gain → dest
            sourceNode.connect(gainNode);
            gainNode.connect(destination);

            // Create audio element
            const audioEl = new Audio();
            audioEl.srcObject = destination.stream;
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            audioEl.setAttribute('data-participant-id', participantId);
            audioEl.setAttribute('data-participant-type', participantType);
            audioEl.setAttribute('data-participant-name', participant.user_name);
            audioEl.setAttribute('data-audio-context', 'true');
            audioEl.setAttribute('data-volume', gainValue);
            audioEl.style.display = 'none';

            // Make sure audio context is running
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            // Force play on the audio element
            audioEl.play().catch(err => {
                console.warn('Audio play failed, will retry on user interaction:', err);
                // Add click handler to resume on user interaction
                const resumeAudio = () => {
                    this.audioContext.resume();
                    audioEl.play();
                    document.removeEventListener('click', resumeAudio);
                };
                document.addEventListener('click', resumeAudio);
            });

            // Store references - make sure we store the gain node!
            this.gainNodes.set(participantId, gainNode);
            this.audioElements.set(participantId, audioEl);

            // Append to body
            document.body.appendChild(audioEl);


            return audioEl;
        } catch (error) {
            console.error('Error creating audio element with gain:', error);
            return null;
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

    cleanupAllAudio() {
        for (const [participantId] of this.audioElements) {
            this.cleanupParticipantAudio(participantId);
        }
    }

    setParticipantVolume(participantId, volume, options = {}) {
        const gainNode = this.gainNodes.get(participantId);
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

            // Update audio element attribute
            const audioEl = this.audioElements.get(participantId);
            if (audioEl) {
                audioEl.setAttribute('data-volume', clampedVolume);
            }
        } else {
            const isIframe = new URLSearchParams(window.location.search).get('isDemo');
            console.warn(`No gain node found for participant ${participantId} ${isIframe ? 'isIframe' : 'isNotIframe'}`);
        }
    }

    /**
     * Smoothly fade in a participant's audio
     * @param {string} participantId - The participant's session ID
     * @param {number} targetVolume - Target volume (0-1)
     * @param {number} duration - Fade duration in seconds
     * @param {string} easing - 'linear' or 'exponential'
     */
    fadeInParticipant(participantId, targetVolume = 1.0, duration = 0.5, easing = 'exponential') {
        const gainNode = this.gainNodes.get(participantId);
        if (gainNode) {
            // Start from current volume or 0 if not set
            const currentVolume = gainNode.gain.value;
            const startVolume = currentVolume > 0 ? currentVolume : 0.0001; // Avoid 0 for exponential

            // Set the starting volume
            gainNode.gain.setValueAtTime(startVolume, this.audioContext.currentTime);

            // Fade to target volume
            this.setParticipantVolume(participantId, targetVolume, {
                duration: duration,
                easing: easing
            });
        }
    }

    /**
     * Smoothly fade out a participant's audio
     * @param {string} participantId - The participant's session ID
     * @param {number} duration - Fade duration in seconds
     * @param {string} easing - 'linear' or 'exponential'
     */
    fadeOutParticipant(participantId, duration = 0.5, easing = 'exponential') {
        this.setParticipantVolume(participantId, 0, {
            duration: duration,
            easing: easing
        });
    }

    /**
     * Smoothly crossfade between two volume levels
     * @param {string} participantId - The participant's session ID
     * @param {number} fromVolume - Starting volume (0-1)
     * @param {number} toVolume - Target volume (0-1)
     * @param {number} duration - Crossfade duration in seconds
     * @param {string} easing - 'linear' or 'exponential'
     */
    crossfadeParticipantVolume(participantId, fromVolume, toVolume, duration = 0.3, easing = 'exponential') {
        const gainNode = this.gainNodes.get(participantId);
        if (gainNode) {
            const currentTime = this.audioContext.currentTime;

            // Set the starting volume immediately
            gainNode.gain.setValueAtTime(fromVolume, currentTime);

            // Apply the transition
            if (easing === 'exponential') {
                const targetValue = toVolume === 0 ? 0.0001 : toVolume;
                gainNode.gain.exponentialRampToValueAtTime(targetValue, currentTime + duration);

                if (toVolume === 0) {
                    gainNode.gain.linearRampToValueAtTime(0, currentTime + duration + 0.001);
                }
            } else {
                gainNode.gain.linearRampToValueAtTime(toVolume, currentTime + duration);
            }
        }
    }

    /**
     * Smoothly adjust volume with a custom curve
     * @param {string} participantId - The participant's session ID
     * @param {number} targetVolume - Target volume (0-1)
     * @param {number} duration - Transition duration in seconds
     * @param {string} curve - 'ease-in', 'ease-out', 'ease-in-out', or 'custom'
     * @param {Function} customCurve - Custom easing function (optional)
     */
    setParticipantVolumeWithCurve(participantId, targetVolume, duration = 0.5, curve = 'ease-out', customCurve = null) {
        const gainNode = this.gainNodes.get(participantId);
        if (!gainNode) return;

        const clampedVolume = Math.max(0, Math.min(1, targetVolume));
        const currentTime = this.audioContext.currentTime;
        const currentVolume = gainNode.gain.value;

        // Set starting volume
        gainNode.gain.setValueAtTime(currentVolume, currentTime);

        if (curve === 'custom' && customCurve) {
            // Use custom curve function
            this.applyCustomVolumeCurve(gainNode, currentVolume, clampedVolume, duration, customCurve);
        } else {
            // Use predefined curves
            switch (curve) {
                case 'ease-in':
                    gainNode.gain.exponentialRampToValueAtTime(clampedVolume === 0 ? 0.0001 : clampedVolume, currentTime + duration);
                    if (clampedVolume === 0) {
                        gainNode.gain.linearRampToValueAtTime(0, currentTime + duration + 0.001);
                    }
                    break;
                case 'ease-out':
                    gainNode.gain.linearRampToValueAtTime(clampedVolume, currentTime + duration);
                    break;
                case 'ease-in-out': {
                    const halfDuration = duration / 2;
                    gainNode.gain.exponentialRampToValueAtTime(clampedVolume === 0 ? 0.0001 : clampedVolume, currentTime + halfDuration);
                    gainNode.gain.linearRampToValueAtTime(clampedVolume, currentTime + duration);
                    if (clampedVolume === 0) {
                        gainNode.gain.linearRampToValueAtTime(0, currentTime + duration + 0.001);
                    }
                    break;
                }
                default:
                    gainNode.gain.linearRampToValueAtTime(clampedVolume, currentTime + duration);
            }
        }

        // Update audio element attribute
        const audioEl = this.audioElements.get(participantId);
        if (audioEl) {
            audioEl.setAttribute('data-volume', clampedVolume);
        }
    }

    /**
     * Apply a custom volume curve using multiple keyframes
     * @param {GainNode} gainNode - The gain node to modify
     * @param {number} startVolume - Starting volume
     * @param {number} endVolume - Ending volume
     * @param {number} duration - Total duration
     * @param {Function} curveFunction - Custom easing function
     */
    applyCustomVolumeCurve(gainNode, startVolume, endVolume, duration, curveFunction) {
        const currentTime = this.audioContext.currentTime;
        const steps = 20; // Number of keyframes
        const stepDuration = duration / steps;

        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const easedProgress = curveFunction(progress);
            const volume = startVolume + (endVolume - startVolume) * easedProgress;
            const time = currentTime + (stepDuration * i);

            if (i === 0) {
                gainNode.gain.setValueAtTime(volume, time);
            } else {
                gainNode.gain.linearRampToValueAtTime(volume, time);
            }
        }
    }

    /**
     * Smoothly mute/unmute a participant with fade
     * @param {string} participantId - The participant's session ID
     * @param {boolean} mute - Whether to mute (true) or unmute (false)
     * @param {number} duration - Fade duration in seconds
     * @param {string} easing - 'linear' or 'exponential'
     */
    toggleParticipantMute(participantId, mute, duration = 0.3, easing = 'exponential') {
        const gainNode = this.gainNodes.get(participantId);
        if (!gainNode) return;

        const targetVolume = mute ? 0 : (this.clientSettings?.human_volume || 0.1);

        if (mute) {
            this.fadeOutParticipant(participantId, duration, easing);
        } else {
            this.fadeInParticipant(participantId, targetVolume, duration, easing);
        }
    }

    /**
     * Create a volume envelope (attack, sustain, release)
     * @param {string} participantId - The participant's session ID
     * @param {number} targetVolume - Target volume (0-1)
     * @param {number} attackTime - Attack time in seconds
     * @param {number} sustainTime - Sustain time in seconds
     * @param {number} releaseTime - Release time in seconds
     */
    applyVolumeEnvelope(participantId, targetVolume, attackTime = 0.1, sustainTime = 1.0, releaseTime = 0.3) {
        const gainNode = this.gainNodes.get(participantId);
        if (!gainNode) return;

        const currentTime = this.audioContext.currentTime;
        const clampedVolume = Math.max(0, Math.min(1, targetVolume));

        // Start at 0
        gainNode.gain.setValueAtTime(0, currentTime);

        // Attack phase
        gainNode.gain.linearRampToValueAtTime(clampedVolume, currentTime + attackTime);

        // Sustain phase
        gainNode.gain.setValueAtTime(clampedVolume, currentTime + attackTime + sustainTime);

        // Release phase
        gainNode.gain.linearRampToValueAtTime(0, currentTime + attackTime + sustainTime + releaseTime);
    }

    /**
     * Smoothly adjust volume with ducking (temporary volume reduction)
     * @param {string} participantId - The participant's session ID
     * @param {number} duckLevel - Volume level during ducking (0-1)
     * @param {number} duckDuration - How long to stay ducked
     * @param {number} fadeInTime - Time to fade back to original volume
     */
    duckParticipantVolume(participantId, duckLevel = 0.3, duckDuration = 2.0, fadeInTime = 0.5) {
        const gainNode = this.gainNodes.get(participantId);
        if (!gainNode) return;

        const currentTime = this.audioContext.currentTime;
        const originalVolume = gainNode.gain.value;
        const clampedDuckLevel = Math.max(0, Math.min(1, duckLevel));

        // Quick fade to duck level
        gainNode.gain.linearRampToValueAtTime(clampedDuckLevel, currentTime + 0.1);

        // Stay at duck level
        gainNode.gain.setValueAtTime(clampedDuckLevel, currentTime + duckDuration);

        // Fade back to original volume
        gainNode.gain.linearRampToValueAtTime(originalVolume, currentTime + duckDuration + fadeInTime);
    }

    /**
     * Get the current volume of a participant
     * @param {string} participantId - The participant's session ID
     * @returns {number} Current volume (0-1) or null if not found
     */
    getParticipantVolume(participantId) {
        const gainNode = this.gainNodes.get(participantId);
        return gainNode ? gainNode.gain.value : null;
    }

    /**
     * Check if a participant is currently muted
     * @param {string} participantId - The participant's session ID
     * @returns {boolean} True if muted (volume near 0), false otherwise
     */
    isParticipantMuted(participantId) {
        const volume = this.getParticipantVolume(participantId);
        return volume !== null && volume < 0.01;
    }

    /**
     * Smoothly adjust all participants' volumes with individual curves
     * @param {Object} volumeMap - Map of participantId to target volume
     * @param {number} duration - Transition duration in seconds
     * @param {string} easing - 'linear' or 'exponential'
     */
    setMultipleParticipantVolumes(volumeMap, duration = 0.5, easing = 'exponential') {
        for (const [participantId, volume] of Object.entries(volumeMap)) {
            this.setParticipantVolume(participantId, volume, { duration, easing });
        }
    }

    /**
     * Create a volume automation sequence
     * @param {string} participantId - The participant's session ID
     * @param {Array} automationPoints - Array of {time, volume} objects
     */
    createVolumeAutomation(participantId, automationPoints) {
        const gainNode = this.gainNodes.get(participantId);
        if (!gainNode) return;

        const currentTime = this.audioContext.currentTime;

        automationPoints.forEach((point, index) => {
            const time = currentTime + point.time;
            const volume = Math.max(0, Math.min(1, point.volume));

            if (index === 0) {
                gainNode.gain.setValueAtTime(volume, time);
            } else {
                gainNode.gain.linearRampToValueAtTime(volume, time);
            }
        });
    }

    /**
     * Smoothly adjust volume for all participants
     * @param {number} volume - Target volume (0-1)
     * @param {Object} options - Transition options
     */
    setAllParticipantsVolume(volume, options = {}) {
        for (const [participantId] of this.audioElements) {
            this.setParticipantVolume(participantId, volume, options);
        }
    }

    /**
     * Fade in all participants' audio
     * @param {number} targetVolume - Target volume (0-1)
     * @param {number} duration - Fade duration in seconds
     * @param {string} easing - 'linear' or 'exponential'
     */
    fadeInAllParticipants(targetVolume = 1.0, duration = 0.5, easing = 'exponential') {
        for (const [participantId] of this.audioElements) {
            this.fadeInParticipant(participantId, targetVolume, duration, easing);
        }
    }

    /**
     * Fade out all participants' audio
     * @param {number} duration - Fade duration in seconds
     * @param {string} easing - 'linear' or 'exponential'
     */
    fadeOutAllParticipants(duration = 0.5, easing = 'exponential') {
        for (const [participantId] of this.audioElements) {
            this.fadeOutParticipant(participantId, duration, easing);
        }
    }

    handleJoinedMeeting(event) {
        this.emitEvent('joined-meeting', event);
    }

    handleLeftMeeting(event) {
        this.cleanupAllAudio();
        this.participants.clear();
        this.emitEvent('left-meeting', event);
    }

    handleParticipantJoined(event) {
        const { participant } = event;
        const participantId = participant.session_id;

        this.participants.set(participantId, participant);


        // Only try to set subscription if auto-subscribe is disabled
        if (!participant.local) {
            // Check if auto-subscribe is disabled before updating
            const callState = this.call.meetingState();
            if (callState === 'joined-meeting') {
                // Defer the subscription update to avoid conflicts
                setTimeout(() => {
                    try {
                        this.call.updateParticipant(participantId, {
                            setSubscribedTracks: {
                                audio: true,
                                video: false,
                                screenVideo: false,
                                screenAudio: false
                            }
                        });
                    } catch (err) {
                        // Silently ignore if auto-subscribe is still enabled
                        if (!err.message.includes('setSubscribeToTracksAutomatically')) {
                            console.warn('Failed to update participant tracks:', err);
                        }
                    }
                }, 100);
            }
        }

        // Create audio element with gain control
        // Always try to create audio element, even if track is not immediately available
        if (participant.audio) {
            if (participant.tracks?.audio) {
                this.createAudioElementWithGain(participant);
            } else {
                // If audio track not available yet, wait a bit and retry
                setTimeout(() => {
                    const updatedParticipant = this.participants.get(participantId);
                    if (updatedParticipant && updatedParticipant.tracks?.audio) {
                        this.createAudioElementWithGain(updatedParticipant);
                    }
                }, 1000);
            }
        }

        this.emitEvent('participant-joined', { participant });
    }

    handleParticipantLeft(event) {
        const { participant } = event;
        const participantId = participant.session_id;

        this.cleanupParticipantAudio(participantId);
        this.participants.delete(participantId);
        this.emitEvent('participant-left', { participant });
    }

    handleParticipantUpdated(event) {
        const { participant } = event;
        const participantId = participant.session_id;

        this.participants.set(participantId, participant);


        // Only try to update subscriptions if video is detected
        if (!participant.local && participant.tracks?.video?.subscribed) {
            setTimeout(() => {
                try {
                    this.call.updateParticipant(participantId, {
                        setSubscribedTracks: {
                            audio: true,
                            video: false,
                            screenVideo: false,
                            screenAudio: false
                        }
                    });
                } catch (err) {
                    // Silently ignore if auto-subscribe is still enabled
                    if (!err.message.includes('setSubscribeToTracksAutomatically')) {
                        console.warn('Failed to maintain audio-only:', err);
                    }
                }
            }, 100);
        }

        // Update or create audio element if track changed
        if (participant.audio && participant.tracks?.audio) {
            const existingAudio = this.audioElements.get(participantId);
            if (!existingAudio) {
                // Audio element doesn't exist yet, create it
                this.createAudioElementWithGain(participant);
            } else {
                // Check if we need to update the gain (in case participant type was misidentified initially)
                const participantType = existingAudio.getAttribute('data-participant-type');
                const currentGain = this.gainNodes.get(participantId);

                // Re-evaluate participant type if it's a bot
                if (participant.user_name && participant.user_name.startsWith('bot-') && currentGain) {
                    const participants = this.call.participants();
                    const localParticipant = Object.values(participants).find(p => p.local);
                    const currentUserName = localParticipant?.user_name;

                    const botNameWithoutPrefix = participant.user_name.replace('bot-', '');
                    const shouldBeBotLocal = currentUserName && botNameWithoutPrefix.startsWith(currentUserName);

                    if (shouldBeBotLocal && participantType !== 'bot-local') {
                        // This bot should be bot-local but wasn't identified correctly
                        existingAudio.setAttribute('data-participant-type', 'bot-local');
                        currentGain.gain.value = 1.0; // Full volume for bot-local
                    }
                }
            }
        }

        this.emitEvent('participant-updated', { participant });
    }

    handleAppMessage(event) {
        const { data, fromId } = event;

        // Handle volume control messages
        if (data && data.event_type === 'set_participant_volume') {
            this.setParticipantVolume(data.participantId, data.volume);
        }

        if (data && (data.event_type === 'p2p_language_change_request' ||
            data.event_type === 'p2p_voice_change_request')) {
            this.emitEvent('p2p-message', { message: data, senderId: fromId });
        }

        this.emitEvent('app-message', event);
    }

    handleActiveSpeakerChange(event) {
        this.emitEvent('active-speaker-change', event);
    }

    handleError(event) {
        console.error('DailyManager: Error:', event);
        this.emitEvent('error', event);
    }

    toggleVideo() {
        // Always return false - video is disabled
        return false;
    }

    toggleAudio(flag = false) {
        if (!this.call) return false;
        this.call.setLocalAudio(flag);
    }

    getCallState() {
        if (!this.call) return null;

        return {
            isJoined: this.call.meetingState() === 'joined-meeting',
            roomUrl: this.currentRoomUrl,
            participants: Array.from(this.participants.values()),
            localVideo: false,
            localAudio: this.call.localAudio(),
            meetingState: this.call.meetingState()
        };
    }

    getCallObject() {
        return this.call;
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

    destroy() {
        this.cleanupAllAudio();

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }

        if (this.call) {
            this.call.destroy();
            this.call = null;
        }

        this.participants.clear();
        this.eventHandlers.clear();
        this.isInitialized = false;
        this.currentRoomUrl = null;

        instance = null;
    }

    reinitialize() {
        if (!this.isInitialized) {
            this.init();
        }
    }

    // Ensure all participants have audio elements
    ensureAllAudioElements() {
        const participants = this.call.participants();
        let created = 0;


        for (const [id, participant] of Object.entries(participants)) {
            if (participant.tracks && participant.tracks?.audio && !this.audioElements.has(id)) {
                this.createAudioElementWithGain(participant);
                created++;
            }
        }

        if (created > 0) {
            // Audio elements were created successfully
        }

        return created;
    }
    debugAudioRouting() {
        for (const [participantId] of this.audioElements) {
            const gainNode = this.gainNodes.get(participantId);

            // Check if gain node is properly stored
            if (!gainNode) {
                console.warn(`  ⚠️  No gain node found for participant ${participantId}!`);
            }

            // Check audio context state
            if (this.audioContext.state === 'suspended') {
                console.warn(`  ⚠️  Audio context is suspended! Click anywhere to resume.`);
            }
        }

        const callState = this.getCallState();
        if (callState) {
            console.log(`Call state: ${callState.meetingState}, Participants: ${callState.participants.length}`);
        }
    }

    handleP2PMessage(message) {

        switch (message.event_type) {
            case 'p2p_language_change_request':
                this.setLanguage(message.language);
                break;

            case 'p2p_voice_change_request':
                this.setVoice(message.voice_key, message.language);
                break;

            default:
                break;
        }
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

// Singleton management
let instance = null;
/**
 * @returns {DailyManager}
 */
export function getDailyManager() {
    if (typeof window === 'undefined') {
        return null;
    }
    if (!instance) {
        instance = new DailyManager();
    }
    return instance;
}

export function resetDailyManager() {
    instance = null;
}

export function createDailyManager() {
    if (typeof window === 'undefined') {
        return null;
    }
    return new DailyManager();
}