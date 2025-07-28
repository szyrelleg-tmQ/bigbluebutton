// --- START OF REVISED FILE IndexWatcher.js ---

import { LANG_KEYS, LOADER, SETTINGS_TYPES } from "./const";
import { getTranslatorClient, ClientProviders } from "translator-client";
import { Watcher } from "./Watcher";
import ClientAsr from "./ClientAsr";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:7860';

/**
 * A singleton Watcher that manages the application's global state,
 * including settings, devices, room state, and provider instances.
 */
class TranslatorManager extends Watcher {
    // Private properties
    #languages = [];
    #voices = [];

    /** @type {import("translator-client").TranslatorClient | null} */
    #translatorClient = null;
    /** @type {import("translator-client").ClientProviders | null} */
    #clientProvider = null;
    /** @type {ClientAsr | null} */
    #activeClientAsr = null;

    #type = { tts: "server", stt: "server", llm: "server" };

    constructor() {
        super();
        this.localBot = null;
        this.enableBot = false;
        this.localBotSessionId = null;
        this.#initialize();
    }

    /**
     * Initial setup for the watcher.
     * @private
     */
    #initialize() {
        this.#initClientProvider();
        this.checkSettings();
    }

    // --- Getters for public access ---

    get Type() { return this.#type; }
    get ClientProvider() { return this.#clientProvider; }
    get Languages() { return this.#languages; }
    get Voices() { return this.#voices; }
    get TranslatorClient() {
        // Lazy initialization if needed
        if (!this.#translatorClient) {
            this.#initTranslatorClient();
        }
        return this.#translatorClient;
    }
    // --- Initialization and Settings ---

    /**
     * Initializes the client-side provider manager.
     * @private
     */
    #initClientProvider() {
        if (this.#clientProvider) return;
        this.#clientProvider = new ClientProviders({
            configUrl: `${API_BASE_URL}/api/settings`
        });
    }

    /**
     * Initializes the server-side translator client.
     * @private
     */
    #initTranslatorClient() {
        if (this.#translatorClient) return;
        this.#translatorClient = getTranslatorClient({ baseUrl: `${API_BASE_URL}/` });
    }

    /**
     * Fetches settings from the server and configures the application type (client/server).
     */
    async checkSettings() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/settings`);
            if (!response.ok) throw new Error(`Failed to fetch settings: ${response.statusText}`);
            const data = await response.json();

            if (data.settings) {
                const { tts_providers, stt_providers, llm_providers } = data.settings;
                this.#type.tts = ["webspeech", "piper"].includes(tts_providers.default_provider) ? "client" : "server";
                this.#type.stt = ["webspeech", "piper"].includes(stt_providers.default_provider) ? "client" : "server";
                this.#type.llm = llm_providers.default_provider === "client_llm" ? "client" : "server";

                // Re-initialize based on new settings
                this.initLanguages();
                this.initVoices();
                this.notify('Type');
            }
        } catch (error) {
            console.error("Error checking settings:", error);
        }
    }

    // --- Language and Voice Initialization ---

    /**
     * Initializes the list of available languages based on the TTS type.
     */
    async initLanguages() {
        try {
            if (this.#type.tts === "server") {
                const languages = await this.TranslatorClient.fetchLanguages();
                this.#languages = languages.map(lang => ({
                    id: lang.key,
                    code: lang.code,
                    language: lang.name,
                    isSelected: lang.key === 'english',
                }));
            } else {
                // For client-side, we wait for the provider to be ready.
                this.#clientProvider.on("pipeline-ready", () => {
                    if (this.#clientProvider.Translation) {
                        this.#languages = Object.entries(this.#clientProvider.Translation.getLanguages()).map(([name, code]) => ({
                            id: name.toLowerCase(),
                            code: code,
                            language: name,
                            isSelected: name.toLowerCase() === 'english',
                        }));
                        this.notify('Languages');
                    }
                });
            }
            this.notify('Languages');
        } catch (error) {
            console.error("Failed to initialize languages:", error);
        }
    }

    /**
     * Initializes the list of available voices based on the TTS type.
     */
    async initVoices() {
        try {
            if (this.#type.tts === "server") {
                const voices = await this.TranslatorClient.fetchVoices();
                this.#voices = voices.map(voice => ({
                    id: voice.key,
                    name: `${voice.name} (${voice.gender})`,
                    isSelected: voice.key === 'aria',
                }));
            } else {
                // For client-side, wait for the provider to be ready.
                this.#clientProvider.on("pipeline-ready", () => {
                    // A timeout gives the browser a moment to populate the speech synthesis voice list.
                    setTimeout(() => {
                        if (this.#clientProvider?.TTS?.getVoices) {
                            const voices = this.#clientProvider.TTS.getVoices();
                            this.#voices = voices.map(voice => ({
                                id: voice.voiceURI,
                                name: voice.name,
                                isSelected: voice.default,
                            }));
                            this.notify('Voices');
                        }
                    }, 500);
                });
            }
            this.notify('Voices');
        } catch (error) {
            console.error("Failed to initialize voices:", error);
        }
    }

    // --- State Changers ---

    /**
     * Resets application state to default values.
     * @private
     */
    #resetToDefaults() {
        this.setValue('currentName', 'Me');
        this.setValue('currentUserLanguage', { id: 'english', name: 'English', code: 'en' });
        this.setValue('currentContactLanguage', { id: 'english', name: 'English', code: 'en' });
        this.setValue('isJoined', false);
        this.setValue('roomId', '');
    }

    /**
     * Sets the user's language and updates providers accordingly.
     * @param {object} language The selected language object.
     */
    setLanguages(key, language) {
        if (key !== LANG_KEYS.USER) return; // Only handling user language for now

        try {
            this.setValue('currentUserLanguage', { id: language.id, name: language.language, code: language.code });
            this.#languages.forEach(lang => lang.isSelected = (lang.id === language.id));
            this.notify('Languages');

            const isJoined = this.getValue('isJoined');

            if (this.#type.tts === "client") {
                this.#activeClientAsr?.setTargetLanguage(language.code);
                this.#clientProvider?.TTS?.setLanguage(language.code);

                // Update voice list for the new language
                const voices = this.#clientProvider?.TTS?.getVoices() ?? [];
                this.#voices = voices.map(v => ({ id: v.voiceURI, name: v.name, isSelected: v.default }));
                this.notify('Voices');
            } else {
                if (isJoined) {
                    this.TranslatorClient?.setLanguage(language.language);
                }
            }

        } catch (error) {
            console.error("Error setting language:", error);
        }
    }

    updateVoiceSelection(voiceId) {
        const selectedVoice = this.#voices.find(v => v.id === voiceId);
        if (!selectedVoice) return;

        this.#voices.forEach(v => v.isSelected = (v.id === voiceId));

        if (this.#type.tts === "client") {
            this.#clientProvider?.TTS?.setVoice(selectedVoice.id);
            this.#activeClientAsr?.setTtsVoice(selectedVoice.id);
        } else {
            this.setValue('currentVoice', selectedVoice.id);
            const lang = this.getValue('currentUserLanguage') || { name: 'English' };
            if (this.getValue('isJoined')) {
                this.TranslatorClient?.setVoice(selectedVoice.id, lang.name);
            }
        }
    }

    toggleTranslation(flag) {
        this.enableBot = flag;
        this.TranslatorClient.CallObject.updateParticipant(this.localBotSessionId, {
            setSubscribedTracks: { audio: flag }
        });
    }

    setParticipantVolume(volume = 0.1) {
        const participants = this.TranslatorClient.CallObject.participants();
        for (let id in participants) {
            if (id === 'local') continue;
            const participant = participants[id];
            const userName = participant.user_name || '';
            // Check if it's NOT a bot
            if (!userName.startsWith('bot-')) {
                this.TranslatorClient.setParticipantVolume(participant.session_id, volume);
            }
        }
    }

    // --- Room Management ---

    async joinRoom() {
        this.setValue(LOADER.ROOM, true);

        try {
            const roomId = this.getValue('roomId');
            const name = this.getValue('currentName') || 'Guest';
            const language = this.getValue('currentUserLanguage')?.id || 'english';
            const voice = this.getValue('currentVoice') || 'aria';

            if (!roomId) {
                throw new Error('Room ID is required.');
            }

            this.#initTranslatorClient(); // Ensure client is ready
            const data = await this.TranslatorClient.startBot(name, language, roomId, voice, false);

            if (data.room_url && data.userName) {
                await this.TranslatorClient.joinRoom(data.room_url, data.userName);
                this.localBot = `bot-${data.userName}`;
                // Initialize client-side ASR if needed
                if (this.#clientProvider) {
                    this.#activeClientAsr = new ClientAsr(this.#clientProvider);
                    this.#activeClientAsr.requestAutoSpeakPermission();
                }

                this.setValue('isJoined', true);
                this.setValue('localSessionId', data.userName);
                this.TranslatorClient.CallObject.setSubscribeToTracksAutomatically(false)
                this.#setupEventListeners();
            }
        } catch (error) {
            console.error("Error joining room:", error);
            this.#destroyAndResetClient();
        } finally {
            this.setValue(LOADER.ROOM, false);
        }
    }



    async leaveRoom() {
        this.setValue(LOADER.ROOM, true);
        try {
            if (this.#translatorClient) {
                await this.#translatorClient.leaveRoom();
            }
        } catch (error) {
            console.error("Error leaving room:", error);
        } finally {
            this.#destroyAndResetClient();
            this.#activeClientAsr = null;
            this.setValue(LOADER.ROOM, false);
        }
    }

    #setupEventListeners() {
        const client = this.TranslatorClient;
        if (!client) return;

        const updateParticipants = async () => {
            this.setValue('participants', client.getParticipants());
            if (!this.localBot) return;
            const participants = client.CallObject.participants();
            let updateList = {};

            for (let id in participants) {
                if (id === 'local') continue;
                const userName = participants[id].user_name || '';

                if (!userName.startsWith('bot-')) {
                    updateList[id] = { setSubscribedTracks: { audio: true } };
                } else {
                    if (userName === this.localBot && this.enableBot) {
                        this.localBotSessionId = participants[id].session_id;
                        updateList[id] = { setSubscribedTracks: { audio: true } };
                    } else {
                        updateList[id] = { setSubscribedTracks: { audio: false } };
                    }
                }
            }

            console.log('[TRANSLATOR] Updating participants subscription:', updateList);
            this.client.CallObject.updateParticipants(updateList);
        }

        client.on('participant-joined', updateParticipants);
        client.on('joined-meeting', updateParticipants);
        client.on('participant-left', updateParticipants);
        client.on('left-meeting', () => {
            this.setValue('participants', []);
            this.#destroyAndResetClient();
        });
    }

    #destroyAndResetClient() {
        this.#translatorClient?.destroy();
        this.#translatorClient = null;
        this.setValue('isJoined', false);
        this.setValue('participants', []);
    }

}

export default new TranslatorManager();