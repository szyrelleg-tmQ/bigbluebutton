
/**
 * Manages client-side Speech-to-Text (STT), Translation, and Text-to-Speech (TTS).
 * This class encapsulates the logic for interacting with client-side AI providers.
 */
class ClientAsr {
    /** @private */
    client;
    /** @private */
    eventListeners = {};
    /** @private */
    isStarting = false;

    // Public state
    currentTranscription = "";
    currentTranslation = "";
    autoSpeakEnabled = false;
    autoSpeakPermissionGranted = false;
    continuousListening = false;
    isManuallyPaused = false;
    sourceLanguage = "en-US";
    targetLanguage = "en-US";
    isListening = false;
    selectedTtsLanguage = "en-US";
    selectedTtsVoice = "";

    /**
     * @param {object} clientProvider The fully initialized ClientProviders instance.
     */
    constructor(clientProvider) {
        if (!clientProvider) {
            throw new Error("ClientAsr requires a valid ClientProvider instance.");
        }
        this.client = clientProvider;
        this.eventListeners = {};

        // Defer provider setup until the next tick to allow event listeners to be attached.
        setTimeout(() => this.initializeWhenReady(), 0);
    }

    // --- Event Emitter ---

    /**
     * Registers an event listener.
     * @param {string} event The event name.
     * @param {Function} callback The callback function.
     */
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }

    /**
     * Emits an event to all registered listeners.
     * @param {string} event The event name.
     * @param {*} [data] The data to pass to the listeners.
     * @private
     */
    emit(event, data) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => callback(data));
        }
    }

    // --- Initialization and Provider Setup ---

    /**
     * Initializes providers once they are available.
     * @private
     */
    initializeWhenReady() {
        // Poll for provider availability instead of using an event listener
        // to ensure robustness if the "ready" event is missed.
        const checkProviders = () => {
            if (this.client?.STT?.startListening) {
                this.setupProviders();
                this.emit("ready");
            } else {
                setTimeout(checkProviders, 300); // Check periodically
            }
        };
        checkProviders();
    }

    /**
     * Sets up all providers and their configurations.
     * @private
     */
    setupProviders() {
        if (this.client.STT) {
            this.setupSpeechRecognition();
            this.emit("stt-ready", this.client.STT.getLanguages());
        }

        if (this.client.Translation) {
            this.emit("translation-ready", {
                sourceLanguages: this.client.Translation.getSourceLanguages(),
                targetLanguages: this.client.Translation.getTargetLanguages(),
            });
        }

        if (this.client.TTS) {
            // Allow a brief moment for voices to be loaded by the browser.
            setTimeout(() => {
                this.emit("tts-ready", {
                    languages: this.client.TTS.getLanguages(),
                    voices: this.client.TTS.getVoices(),
                });
            }, 500);
        }
    }

    /**
     * Configures the STT provider with event handlers.
     * @private
     */
    setupSpeechRecognition() {
        const { STT } = this.client;
        if (STT.setContinuous) {
            STT.setContinuous(true);
        }

        STT.onResult(data => this.emit("transcription-result", data.results));

        STT.onFinalResult(async (result) => {
            const transcript = result.transcript;
            if (!transcript.trim()) return;

            this.currentTranscription = transcript;
            this.emit("transcription-final", transcript);
            try {
                await this.translateText(transcript);
            } catch (error) {
                console.error("Auto-translation failed after final result:", error);
            }
        });

        STT.onError((error) => {
            console.error("Speech recognition error:", error);
            this.isListening = false;
            this.emit("error", error);
            this.handleRestart();
        });

        STT.onStart(() => {
            this.isListening = true;
            this.isStarting = false;
            this.emit("listening-start");
        });

        STT.onEnd(() => {
            this.isListening = false;
            this.emit("listening-end");
            this.handleRestart();
        });
    }

    /**
     * Handles the logic for restarting the STT service.
     * @private
     */
    handleRestart() {
        if (this.continuousListening && !this.isManuallyPaused) {
            // Use a small delay to prevent rapid-fire restarts
            setTimeout(() => {
                if (!this.isListening && !this.isStarting) {
                    this.startListening().catch(console.error);
                }
            }, 500);
        }
    }

    // --- Public Methods ---

    /**
     * Starts the speech recognition service.
     * @param {MediaStream} [audioStream] Optional audio stream to use instead of the microphone.
     * @returns {Promise<void>}
     */
    async startListening(audioStream) {
        if (this.isListening || this.isStarting) {
            console.warn("STT is already starting or listening.");
            return;
        }

        try {
            if (!this.client?.STT) {
                throw new Error("STT client is not available.");
            }

            this.isStarting = true;
            this.isManuallyPaused = false;
            this.emit("listening-start-pending");

            if (audioStream && typeof this.client.STT.startListeningWithStream === 'function') {
                await this.client.STT.startListeningWithStream(audioStream);
            } else {
                await this.client.STT.startListening();
            }
        } catch (error) {
            console.error("Failed to start speech recognition:", error);
            this.isStarting = false;
            this.emit("error", { message: "Failed to start listening.", cause: error });
            throw error; // Re-throw for the caller to handle
        }
    }

    /**
     * Stops the speech recognition service.
     */
    stopListening() {
        if (this.isListening) {
            this.isManuallyPaused = true;
            this.client.STT.stopListening();
        }
    }

    /**
     * Translates a given text.
     * @param {string} [text=this.currentTranscription] The text to translate.
     * @returns {Promise<string>} The translated text.
     */
    async translateText(text = this.currentTranscription) {
        if (!text?.trim() || !this.client?.Translation) {
            return;
        }

        this.emit("translation-start");
        try {
            const result = await this.client.Translation.translateText({
                text: text,
                source: this.sourceLanguage,
                target: this.targetLanguage,
            });

            const translatedText = result.text || result;
            this.currentTranslation = translatedText;
            this.emit("translation-complete", translatedText);

            if (this.autoSpeakEnabled && this.autoSpeakPermissionGranted && translatedText) {
                this.speak(translatedText);
            }
            return translatedText;
        } catch (error) {
            console.error("Translation error:", error);
            this.emit("translation-error", error);
            throw error;
        }
    }

    /**
     * Speaks the given text using the TTS provider.
     * @param {string} text The text to speak.
     */
    speak(text) {
        if (!text || !this.client?.TTS) {
            return;
        }
        try {
            this.emit("tts-start", text);
            this.client.TTS.speak(text);
        } catch (error) {
            console.error("TTS speak failed:", error);
            this.emit("tts-error", error);
        }
    }

    /**
     * Sets the language for the TTS provider.
     * This will also update the available voices.
     * @param {string} languageCode The BCP-47 language code (e.g., "en-US").
     */
    setTtsLanguage(languageCode) {
        if (!this.client?.TTS) return;
        try {
            this.selectedTtsLanguage = languageCode;
            this.client.TTS.setLanguage(languageCode);

            const voices = this.client.TTS.getVoices();
            this.emit("tts-language-changed", { language: languageCode, voices });

            // Automatically select the default voice for the new language
            const defaultVoice = voices.find(v => v.default) || voices[0];
            if (defaultVoice) {
                this.setTtsVoice(defaultVoice.voiceURI);
            }
        } catch (error) {
            console.error("Failed to set TTS language:", error);
            this.emit("tts-error", error);
        }
    }

    /**
     * Sets the voice for the TTS provider.
     * @param {string} voiceURI The URI or key of the voice to use.
     */
    setTtsVoice(voiceURI) {
        if (!this.client?.TTS) return;
        try {
            this.selectedTtsVoice = voiceURI;
            this.client.TTS.setVoice(voiceURI);
            this.emit("tts-voice-changed", voiceURI);
        } catch (error) {
            console.error("Failed to set TTS voice:", error);
            this.emit("tts-error", error);
        }
    }

    /**
     * Requests permission for auto-speaking by playing a silent sound.
     * This is necessary to bypass browser restrictions on autoplaying audio.
     * @returns {Promise<boolean>}
     */
    async requestAutoSpeakPermission() {
        try {
            if (!this.client?.TTS) {
                throw new Error("TTS provider not available.");
            }
            // A silent or near-silent playback is a common way to "unlock" audio.
            await this.client.TTS.speak(" ");
            this.autoSpeakPermissionGranted = true;
            this.emit("auto-speak-permission-granted");
            return true;
        } catch (error) {
            console.error("Auto-speak permission denied:", error);
            this.autoSpeakPermissionGranted = false;
            this.emit("auto-speak-permission-denied", error);
            return false;
        }
    }

    // --- Getters and Setters for State ---

    setContinuous(enabled, autoStart = true) {
        this.continuousListening = enabled;
        this.emit("continuous-changed", enabled);
        if (enabled && autoStart && !this.isListening && !this.isManuallyPaused) {
            this.startListening().catch(console.error);
        } else if (!enabled) {
            this.stopListening();
        }
    }

    setSourceLanguage(lang) {
        this.sourceLanguage = lang;
        this.emit("source-language-changed", lang);
    }

    setTargetLanguage(lang) {
        this.targetLanguage = lang;
        this.emit("target-language-changed", lang);
    }

    setAutoSpeak(enabled) {
        this.autoSpeakEnabled = enabled;
        this.emit("auto-speak-changed", enabled);
    }
}

export default ClientAsr;