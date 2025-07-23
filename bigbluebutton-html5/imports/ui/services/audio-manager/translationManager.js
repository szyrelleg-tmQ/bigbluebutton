export class TranslationManager {
    constructor() {
        this.audioCtx = null;
        this.mixedDestination = null;
        this.participantSources = new Map();
    }

    initializeAudioContext() {
        if (!this.audioCtx) {
            this.audioCtx = new AudioContext();
            this.mixedDestination = this.audioCtx.createMediaStreamDestination();

            // Route mixed audio to BBB
            this.routeToBigBlueButton(this.mixedDestination.stream);
        }
    }

    captureParticipantAudio(participant, localBot) {
        if (!participant || participant.local) return;

        console.log('[DAILY] Capturing audio from participant:', participant.user_name || participant.session_id);

        const audioTrack = participant.audioTrack;
        if (!audioTrack) return;

        this.initializeAudioContext();

        // Clean up existing source for this participant
        this.removeParticipantAudio(participant.session_id);

        try {
            const audioStream = new MediaStream([audioTrack]);
            const source = this.audioCtx.createMediaStreamSource(audioStream);
            const gainNode = this.audioCtx.createGain();

            gainNode.gain.value = 0.1; // Volume control
            source.connect(gainNode);
            gainNode.connect(this.mixedDestination); // Mix into combined stream

            // Store reference for cleanup
            this.participantSources.set(participant.session_id, {
                source,
                gainNode,
                participant
            });

        } catch (error) {
            console.error('[DAILY] Failed to process participant audio:', error);
        }
    }

    removeParticipantAudio(sessionId) {
        const sourceInfo = this.participantSources.get(sessionId);
        if (sourceInfo) {
            try {
                sourceInfo.source.disconnect();
                sourceInfo.gainNode.disconnect();
            } catch (error) {
                console.error('[DAILY] Error disconnecting audio nodes:', error);
            }
            this.participantSources.delete(sessionId);
        }
    }

    routeToBigBlueButton(mixedStream) {
        try {
            const MEDIA = window.meetingClientSettings.public.media;
            const MEDIA_TAG = MEDIA.mediaTag;
            const bbbAudioElement = document.querySelector(MEDIA_TAG);

            if (bbbAudioElement) {
                bbbAudioElement.srcObject = mixedStream;
                bbbAudioElement.play().catch((error) => {
                    console.error('[DAILY] Failed to play audio in BBB element:', error);
                });
                console.log('[DAILY] Successfully routed mixed audio to BigBlueButton');
            }
        } catch (error) {
            console.error('[DAILY] Failed to route audio to BigBlueButton:', error);
        }
    }

    cleanup() {
        // Clean up all participant sources
        this.participantSources.forEach((sourceInfo, sessionId) => {
            this.removeParticipantAudio(sessionId);
        });

        // Close audio context
        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            this.audioCtx.close();
        }

        this.audioCtx = null;
        this.mixedDestination = null;
    }
}
