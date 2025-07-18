import logger from '/imports/startup/client/logger';

/**
 * Daily.co Integration Utilities
 * Provides helper functions for integrating Daily.co with BigBlueButton audio
 */

class DailyCoIntegration {
    constructor() {
        this.isActive = false;
        this.callObject = null;
        this.audioElement = null;
    }

    /**
     * Initialize Daily.co integration
     * @param {Object} callObject - The Daily.co call object
     */
    initialize(callObject) {
        this.callObject = callObject;
        this.isActive = true;

        // Set up event listeners to capture Daily.co's remote audio
        this._setupDailyAudioCapture();

        logger.info({
            logCode: 'daily_co_integration_initialized',
        }, 'Daily.co integration initialized');
    }

    /**
     * Set up event listeners to capture Daily.co's remote audio
     * @private
     */
    _setupDailyAudioCapture() {
        if (!this.callObject) return;

        // Listen for remote participants joining
        this.callObject.on('participant-joined', (event) => {
            console.log('[DAILY] Participant joined:', event.participant);
            this._captureParticipantAudio(event.participant);
        });

        // Listen for remote participants leaving
        this.callObject.on('participant-left', (event) => {
            console.log('[DAILY] Participant left:', event.participant);
            this._removeParticipantAudio(event.participant);
        });

        // Listen for existing participants when we join
        this.callObject.on('joined-meeting', (event) => {
            console.log('[DAILY] Joined meeting, capturing existing participants');
            // Capture audio from all existing participants
            Object.values(this.callObject.participants()).forEach(participant => {
                this._captureParticipantAudio(participant);
            });
        });

        // Listen for track updates
        this.callObject.on('track-started', (event) => {
            console.log('[DAILY] Track started:', event);
            if (event.participant && event.track.kind === 'audio') {
                this._captureParticipantAudio(event.participant);
            }
        });

        this.callObject.on('track-stopped', (event) => {
            console.log('[DAILY] Track stopped:', event);
            if (event.participant && event.track.kind === 'audio') {
                this._removeParticipantAudio(event.participant);
            }
        });
    }

    /**
     * Capture audio from a Daily.co participant
     * @param {Object} participant - The Daily.co participant object
     * @private
     */
    _captureParticipantAudio(participant) {
        if (!participant || participant.local) return; // Skip local participant

        console.log('[DAILY] Capturing audio from participant:', participant.user_name || participant.session_id);

        const isBot = participant.user_name.startsWith('bot-user-');
        if (!isBot) {
            console.log('[DAILY] Not a bot =============================');
            return
        }

        // Get the participant's audio track
        const audioTrack = participant.audioTrack;
        if (audioTrack) {
            // Create a MediaStream from the audio track
            const audioStream = new MediaStream([audioTrack]);

            // Route this audio stream to BigBlueButton's audio system
            this._routeToBigBlueButton(audioStream, participant);
        }
    }

    /**
     * Remove audio from a Daily.co participant
     * @param {Object} participant - The Daily.co participant object
     * @private
     */
    _removeParticipantAudio(participant) {
        if (!participant || participant.local) return;

        console.log('[DAILY] Removing audio from participant:', participant.user_name || participant.session_id);

        // Remove the participant's audio from BigBlueButton
        this._removeFromBigBlueButton(participant.session_id);
    }

    /**
     * Route Daily.co audio stream to BigBlueButton's audio system
     * @param {MediaStream} audioStream - The audio stream from Daily.co
     * @param {Object} participant - The Daily.co participant
     * @private
     */
    _routeToBigBlueButton(audioStream, participant) {
        try {
            // Get BigBlueButton's remote media element
            const MEDIA = window.meetingClientSettings.public.media;
            const MEDIA_TAG = MEDIA.mediaTag;
            const bbbAudioElement = document.querySelector(MEDIA_TAG);

            if (bbbAudioElement) {
                // Replace BigBlueButton's remote stream with Daily.co's audio
                bbbAudioElement.srcObject = audioStream;
                bbbAudioElement.play().catch((error) => {
                    console.error('[DAILY] Failed to play Daily.co audio in BBB element:', error);
                });

                console.log('[DAILY] Successfully routed Daily.co audio to BigBlueButton');

                // Store reference for cleanup
                this._currentDailyStream = audioStream;
                this._currentParticipantId = participant.session_id;
            }
        } catch (error) {
            logger.error({
                logCode: 'daily_co_route_to_bbb_failed',
                extraInfo: {
                    errorName: error.name,
                    errorMessage: error.message,
                    participantId: participant.session_id,
                },
            }, `Failed to route Daily.co audio to BigBlueButton: ${error.message}`);
        }
    }

    /**
     * Remove Daily.co audio from BigBlueButton's audio system
     * @param {string} participantId - The Daily.co participant ID
     * @private
     */
    _removeFromBigBlueButton(participantId) {
        if (this._currentParticipantId === participantId) {
            // Restore original BigBlueButton audio or clear the element
            const MEDIA = window.meetingClientSettings.public.media;
            const MEDIA_TAG = MEDIA.mediaTag;
            const bbbAudioElement = document.querySelector(MEDIA_TAG);

            if (bbbAudioElement) {
                bbbAudioElement.pause();
                bbbAudioElement.srcObject = null;
                console.log('[DAILY] Removed Daily.co audio from BigBlueButton');
            }

            this._currentDailyStream = null;
            this._currentParticipantId = null;
        }
    }

    /**
     * Change audio output device for Daily.co
     * @param {string} deviceId - The device ID to set
     */
    async changeOutputDevice(deviceId) {
        if (!this.isActive || !this.callObject) {
            throw new Error('Daily.co integration not active');
        }

        try {
            // If Daily.co supports output device selection
            if (typeof this.callObject.setAudioOutputDevice === 'function') {
                await this.callObject.setAudioOutputDevice(deviceId);
            }

            // Update BigBlueButton's audio element output device since Daily.co audio is routed there
            const MEDIA = window.meetingClientSettings.public.media;
            const MEDIA_TAG = MEDIA.mediaTag;
            const bbbAudioElement = document.querySelector(MEDIA_TAG);

            if (bbbAudioElement && typeof bbbAudioElement.setSinkId === 'function') {
                await bbbAudioElement.setSinkId(deviceId);
            }

            logger.info({
                logCode: 'daily_co_output_device_changed',
                extraInfo: {
                    deviceId,
                },
            }, `Daily.co output device changed to: ${deviceId}`);
        } catch (error) {
            logger.error({
                logCode: 'daily_co_output_device_change_failed',
                extraInfo: {
                    errorName: error.name,
                    errorMessage: error.message,
                    deviceId,
                },
            }, `Failed to change Daily.co output device: ${error.message}`);
            throw error;
        }
    }

    /**
     * Create a dedicated audio element for Daily.co
     * @param {MediaStream} remoteStream - The remote audio stream
     * @private
     */
    _createAudioElement(remoteStream) {
        // Remove existing audio element if it exists
        this._removeAudioElement();

        // Create new audio element
        this.audioElement = document.createElement('audio');
        this.audioElement.id = 'daily-co-remote-audio';
        this.audioElement.style.display = 'none';
        this.audioElement.autoplay = true;
        this.audioElement.srcObject = remoteStream;

        // Add to document
        document.body.appendChild(this.audioElement);

        // Play the audio
        this.audioElement.play().catch((error) => {
            logger.error({
                logCode: 'daily_co_audio_play_failed',
                extraInfo: {
                    errorName: error.name,
                    errorMessage: error.message,
                },
            }, `Failed to play Daily.co audio: ${error.message}`);
        });

        logger.debug({
            logCode: 'daily_co_audio_element_created',
        }, 'Daily.co audio element created');
    }

    /**
     * Remove the Daily.co audio element
     * @private
     */
    _removeAudioElement() {
        if (this.audioElement) {
            try {
                this.audioElement.pause();
                this.audioElement.srcObject = null;
                this.audioElement.remove();
                this.audioElement = null;

                logger.debug({
                    logCode: 'daily_co_audio_element_removed',
                }, 'Daily.co audio element removed');
            } catch (error) {
                logger.error({
                    logCode: 'daily_co_audio_element_removal_failed',
                    extraInfo: {
                        errorName: error.name,
                        errorMessage: error.message,
                    },
                }, `Failed to remove Daily.co audio element: ${error.message}`);
            }
        }
    }

    /**
     * Clean up Daily.co integration
     */
    cleanup() {
        // Remove Daily.co audio from BigBlueButton
        this._removeFromBigBlueButton(this._currentParticipantId);

        // Remove event listeners from Daily.co call object
        if (this.callObject) {
            try {
                this.callObject.off('participant-joined');
                this.callObject.off('participant-left');
                this.callObject.off('joined-meeting');
                this.callObject.off('track-started');
                this.callObject.off('track-stopped');
            } catch (error) {
                logger.error({
                    logCode: 'daily_co_event_cleanup_failed',
                    extraInfo: {
                        errorName: error.name,
                        errorMessage: error.message,
                    },
                }, `Failed to cleanup Daily.co event listeners: ${error.message}`);
            }
        }

        this._removeAudioElement();

        if (this.callObject) {
            try {
                this.callObject.leave();
                this.callObject.destroy();
            } catch (error) {
                logger.error({
                    logCode: 'daily_co_cleanup_failed',
                    extraInfo: {
                        errorName: error.name,
                        errorMessage: error.message,
                    },
                }, `Failed to cleanup Daily.co: ${error.message}`);
            }
        }

        this.callObject = null;
        this.isActive = false;
        this._currentDailyStream = null;
        this._currentParticipantId = null;

        logger.info({
            logCode: 'daily_co_integration_cleaned_up',
        }, 'Daily.co integration cleaned up');
    }

    /**
     * Check if Daily.co integration is active
     * @returns {boolean}
     */
    isIntegrationActive() {
        return this.isActive && this.callObject !== null;
    }

    /**
     * Get the current Daily.co call object
     * @returns {Object|null}
     */
    getCallObject() {
        return this.callObject;
    }
}

// Create singleton instance
const dailyCoIntegration = new DailyCoIntegration();

export default dailyCoIntegration; 