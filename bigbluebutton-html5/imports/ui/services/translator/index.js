import { getTranslatorClient, DeviceDetection, ClientProviders } from "translator-client";
import logger from "/imports/startup/client/logger";
import { Watcher } from "./Watcher";

const DEFAULT_TRANSLATOR_BASE_URL = 'http://localhost:7860';
const DEFAULT_VOICE = 'aria';
const DEFAULT_LANGUAGE = 'english';
const TYPE_SERVER = 'server';
const TYPE_CLIENT = 'client';

function mapVoiceServer(voice) {
    return {
        id: voice.key,
        name: voice.name + ` (${voice.gender})`,
        isSelected: voice.key === DEFAULT_VOICE
    };
}

function mapVoiceClient(voice) {
    return {
        id: voice.voiceURI,
        name: voice.name,
        isSelected: voice.default
    };
}

function mapLanguageServer(language) {
    return {
        id: language.key,
        code: language.code,
        language: language.name,
        isSelected: language.key === DEFAULT_LANGUAGE
    };
}

function mapLanguageClient([name, code]) {
    return {
        id: name.toLowerCase(),
        code: code,
        language: name,
        isSelected: name.toLowerCase() === DEFAULT_LANGUAGE
    };
}

class Translator extends Watcher {
    #clientProvider = null;
    #clientTranslator = null;
    #voices = [];
    #languages = [];
    #type = {
        tts: "server",
        stt: "server",
        llm: "server",
    };

    /**
     * Promise that resolves when the translator is fully initialized.
     * Usage: await translator.ready;
     */
    #ready;

    constructor() {
        // Begin async initialization and expose the promise
        this.#ready = this.checkSettingsAndInit();
        // Do not call async methods directly in constructor
    }

    /**
     * Returns a promise that resolves when the translator is ready.
     */
    get ready() {
        return this.#ready;
    }
    get Type() {
        return { ...this.#type };
    }

    /**
     * Public method to reinitialize the translator client and settings.
     * Usage: await translator.reinitialize();
     */
    async reinitialize() {
        logger.info({ logCode: 'translator_reinit_requested' }, 'Reinitializing translator client');
        this.#ready = this.checkSettingsAndInit();

        try {
            const result = await this.#ready;
            logger.info({
                logCode: 'translator_reinit_complete',
                extraInfo: { success: result },
            }, `Reinitialization completed with result: ${result}`);

            if (result) {
                // After reinitialization, initialize voices and languages
                try {
                    await this.initVoices();
                    logger.info({ logCode: 'translator_reinit_voices_success' }, 'Voice initialization completed during reinit');
                } catch (err) {
                    logger.error({
                        logCode: 'translator_reinit_voices_failed',
                        error: err,
                    }, 'Voice initialization failed during reinit');
                }

                try {
                    await this.initLanguages();
                    logger.info({ logCode: 'translator_reinit_languages_success' }, 'Language initialization completed during reinit');
                } catch (err) {
                    logger.error({
                        logCode: 'translator_reinit_languages_failed',
                        error: err,
                    }, 'Language initialization failed during reinit');
                }
            }

            return result;
        } catch (err) {
            logger.error({
                logCode: 'translator_reinit_exception',
                error: err,
            }, 'Exception during reinitialization');
            throw err;
        }
    }

    /**
     * Returns true if the translator client is already initialized.
     */
    isInitialized() {
        return !!(this.#clientProvider && this.#clientTranslator);
    }

    /**
     * Resets the translator client and provider, allowing re-initialization.
     */
    reset() {
        this.#clientProvider = null;
        this.#clientTranslator = null;
    }

    /**
     * Safely retrieves the translator server base URL from settings, with fallback and normalization.
     * @returns {string} The base URL for the translator server.
     */
    getBaseUrl() {
        try {
            const url = window?.meetingClientSettings?.private?.translatorServer?.baseUrl;
            if (typeof url === 'string' && url.trim() !== '') {
                // Remove trailing slash for consistency
                return url.replace(/\/$/, '');
            }
        } catch (err) {
            logger.warn({
                logCode: 'translator_baseurl_access_error',
                error: err,
            }, 'Error accessing translator server baseUrl, using default');
        }
        return DEFAULT_TRANSLATOR_BASE_URL;
    }

    /**
     * Initializes the translator client and provider with robust error handling.
     * Will not re-initialize if already initialized, unless forced.
     * @param {string} [baseUrl] Optional override for the base URL.
     * @param {boolean} [force] If true, will reset and re-initialize.
     */
    initTranslatorClient(baseUrl, force = false) {
        if (this.isInitialized() && !force) {
            logger.info({
                logCode: 'translator_already_initialized',
                extraInfo: { baseUrl: baseUrl || this.getBaseUrl() },
            }, 'Translator client is already initialized, skipping re-initialization');
            return;
        }
        if (force) {
            logger.info({ logCode: 'translator_force_reinit' }, 'Force re-initializing translator client');
            this.reset();
        }
        const resolvedBaseUrl = baseUrl || this.getBaseUrl();
        logger.info({
            logCode: 'translator_init_client_start',
            extraInfo: {
                baseUrl: resolvedBaseUrl,
            },
        }, 'Starting translator client initialization');
        try {
            this.#clientProvider = new ClientProviders({
                configUrl: resolvedBaseUrl,
            });
            logger.info({ logCode: 'translator_provider_created' }, 'Client provider created successfully');

            this.#clientTranslator = getTranslatorClient({
                baseUrl: resolvedBaseUrl,
            });
            logger.info({ logCode: 'translator_client_created' }, 'Translator client created successfully');

            logger.info({
                logCode: 'translator_init_client_success',
                extraInfo: { baseUrl: resolvedBaseUrl },
            }, 'Translator client initialization completed successfully');
        } catch (err) {
            logger.error({
                logCode: 'translator_init_client_error',
                error: err,
                extraInfo: { baseUrl: resolvedBaseUrl },
            }, 'Error initializing translator client');
            throw err; // Re-throw to allow calling code to handle the error
        }
    }

    async initVoices() {
        logger.info({ logCode: 'translator_init_voices_start' }, 'Starting voice initialization');

        if (!this.#clientProvider || !this.#clientTranslator) {
            logger.warn({
                logCode: 'translator_client_not_initialized',
            }, 'Translator client is not initialized, attempting re-initialization');
            await this.reinitialize();
        }

        if (this.#type.tts === TYPE_SERVER) {
            logger.info({ logCode: 'translator_voices_server_mode' }, 'Initializing voices in server mode');
            try {
                const voices = await this.#clientProvider.fetchVoices();
                if (voices && voices.length > 0) {
                    this.#voices = voices.map(mapVoiceServer);
                    logger.info({
                        logCode: 'translator_voices_server_success',
                        extraInfo: { voiceCount: this.#voices.length },
                    }, `Successfully fetched ${this.#voices.length} voices from server`);
                } else {
                    logger.warn({
                        logCode: 'translator_fetch_voices_empty',
                    }, 'No voices returned from server');
                }
            } catch (err) {
                logger.error({
                    logCode: 'translator_fetch_voices_exception',
                    error: err,
                }, 'Exception while fetching voices from server');
                throw err;
            }
        } else {
            logger.info({ logCode: 'translator_voices_client_mode' }, 'Initializing voices in client mode');
            // Client-side TTS
            const voices = this.#clientProvider?.TTS?.getVoices?.();
            if (voices && voices.length > 0) {
                this.#voices = voices.map(mapVoiceClient);
                logger.info({
                    logCode: 'translator_voices_client_success',
                    extraInfo: { voiceCount: this.#voices.length },
                }, `Successfully fetched ${this.#voices.length} voices from client TTS`);
            } else {
                logger.warn({
                    logCode: 'translator_fetch_voices_error',
                }, 'No voices found in client TTS');
            }
        }

        logger.info({
            logCode: 'translator_init_voices_complete',
            extraInfo: { totalVoices: this.#voices.length },
        }, 'Voice initialization completed');
    }

    async initLanguages() {
        logger.info({ logCode: 'translator_init_languages_start' }, 'Starting language initialization');

        if (!this.#clientProvider || !this.#clientTranslator) {
            logger.warn({
                logCode: 'translator_client_not_initialized',
            }, 'Translator client is not initialized, attempting re-initialization');
            await this.reinitialize();
        }

        if (this.#type.stt === TYPE_SERVER) {
            logger.info({ logCode: 'translator_languages_server_mode' }, 'Initializing languages in server mode');
            try {
                const languages = await this.#clientTranslator.fetchLanguages();
                if (languages && languages.length > 0) {
                    this.#languages = languages.map(mapLanguageServer);
                    logger.info({
                        logCode: 'translator_languages_server_success',
                        extraInfo: { languageCount: this.#languages.length },
                    }, `Successfully fetched ${this.#languages.length} languages from server`);
                } else {
                    logger.warn({
                        logCode: 'translator_fetch_languages_empty',
                    }, 'No languages returned from server');
                }
            } catch (err) {
                logger.error({
                    logCode: 'translator_fetch_languages_exception',
                    error: err,
                }, 'Exception while fetching languages from server');
                throw err;
            }
        } else {
            logger.info({ logCode: 'translator_languages_client_mode' }, 'Initializing languages in client mode');
            // Client-side Translation
            const pollLanguages = () => {
                if (this.#clientProvider?.Translation) {
                    const langs = Object.entries(this.#clientProvider.Translation.getLanguages());
                    this.#languages = langs.map(mapLanguageClient);
                    logger.info({
                        logCode: 'translator_languages_client_success',
                        extraInfo: { languageCount: this.#languages.length },
                    }, `Successfully fetched ${this.#languages.length} languages from client translation`);
                    return true;
                }
                return false;
            };
            if (!pollLanguages()) {
                logger.info({ logCode: 'translator_languages_polling_start' }, 'Starting polling for client languages');
                const translationCheckInterval = setInterval(() => {
                    if (pollLanguages()) {
                        clearInterval(translationCheckInterval);
                        logger.info({ logCode: 'translator_languages_polling_success' }, 'Successfully polled for client languages');
                    }
                }, 1000);
            }
        }

        logger.info({
            logCode: 'translator_init_languages_complete',
            extraInfo: { totalLanguages: this.#languages.length },
        }, 'Language initialization completed');
    }

    /**
     * Fetches translator settings from the server with error handling.
     * @returns {Promise<Object|null>} The parsed settings object or null if failed.
     */
    async fetchSettings() {
        const baseUrl = this.getBaseUrl();
        const url = `${baseUrl}/api/settings`;
        logger.info({
            logCode: 'translator_fetch_settings_start',
            extraInfo: { url },
        }, 'Starting to fetch translator settings');

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch settings: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            logger.info({
                logCode: 'translator_fetch_settings_success',
                extraInfo: {
                    url,
                    hasSettings: !!data?.settings,
                    ttsProvider: data?.settings?.tts_providers?.default_provider,
                    sttProvider: data?.settings?.stt_providers?.default_provider,
                    llmProvider: data?.settings?.llm_providers?.default_provider,
                },
            }, 'Successfully fetched translator settings');
            return data;
        } catch (err) {
            logger.error({
                logCode: 'translator_fetch_settings_error',
                error: err,
                extraInfo: { url },
            }, 'Error fetching translator settings');
            return null;
        }
    }

    /**
     * Checks and applies translator settings, then initializes the client accordingly.
     * @returns {Promise<boolean>} True if settings were applied, false otherwise.
     */
    async checkSettingsAndInit() {
        logger.info({ logCode: 'translator_check_settings_start' }, 'Starting settings check and initialization');

        const data = await this.fetchSettings();
        if (data && data.settings) {
            logger.info({ logCode: 'translator_settings_found' }, 'Translator settings found, proceeding with initialization');

            // Set type based on settings
            const { tts_providers, stt_providers, llm_providers } = data.settings;
            this.#type.tts = ["webspeech", "piper"].includes(tts_providers?.default_provider) ? TYPE_CLIENT : TYPE_SERVER;
            this.#type.stt = ["webspeech", "piper"].includes(stt_providers?.default_provider) ? TYPE_CLIENT : TYPE_SERVER;
            this.#type.llm = llm_providers?.default_provider === "client_llm" ? TYPE_CLIENT : TYPE_SERVER;

            logger.info({
                logCode: 'translator_type_determined',
                extraInfo: {
                    ttsType: this.#type.tts,
                    sttType: this.#type.stt,
                    llmType: this.#type.llm,
                    ttsProvider: tts_providers?.default_provider,
                    sttProvider: stt_providers?.default_provider,
                    llmProvider: llm_providers?.default_provider,
                },
            }, 'Translator types determined based on settings');

            // Now initialize the client with the correct base URL
            try {
                this.initTranslatorClient();
                logger.info({ logCode: 'translator_client_init_complete' }, 'Translator client initialization completed');

                if (this.isInitialized()) {
                    logger.info({ logCode: 'translator_post_init_start' }, 'Starting post-initialization setup');

                    // After initialization, initialize voices and languages
                    try {
                        await this.initVoices();
                        logger.info({ logCode: 'translator_voices_init_complete' }, 'Voice initialization completed successfully');
                    } catch (err) {
                        logger.error({
                            logCode: 'translator_voices_init_failed',
                            error: err,
                        }, 'Voice initialization failed');
                    }

                    try {
                        await this.initLanguages();
                        logger.info({ logCode: 'translator_languages_init_complete' }, 'Language initialization completed successfully');
                    } catch (err) {
                        logger.error({
                            logCode: 'translator_languages_init_failed',
                            error: err,
                        }, 'Language initialization failed');
                    }

                    logger.info({
                        logCode: 'translator_full_init_success',
                        extraInfo: {
                            voiceCount: this.#voices.length,
                            languageCount: this.#languages.length,
                        },
                    }, 'Full translator initialization completed successfully');
                    return true;
                } else {
                    logger.error({
                        logCode: 'translator_init_failed',
                        extraInfo: {
                            clientProviderExists: !!this.#clientProvider,
                            clientTranslatorExists: !!this.#clientTranslator,
                        },
                    }, 'Translator client failed to initialize');
                    return false;
                }
            } catch (err) {
                logger.error({
                    logCode: 'translator_client_init_exception',
                    error: err,
                }, 'Exception during translator client initialization');
                return false;
            }
        } else {
            logger.warn({
                logCode: 'translator_settings_disabled',
                extraInfo: {
                    hasData: !!data,
                    hasSettings: !!data?.settings,
                    settings: data?.settings,
                },
            }, 'Translator settings are disabled or missing');
            return false;
        }
    }

    async joinRoom(roomId, username) {
        const language = DEFAULT_LANGUAGE;
        const voice = DEFAULT_VOICE;
        if (!roomId || !username) {
            logger.error({
                logCode: 'translator_join_room_error',
                extraInfo: { roomId, username },
            }, 'Invalid parameters for joining room');
            return;
        }
        if (this.isInitialized) {
            const data = await this.#clientTranslator.startBot(username, language, roomId, voice, false);
            await this.#clientTranslator.joinRoom(data.room_url, data.userName);

            this.#clientTranslator.on('participant-joined', () => this.setValue('participants', this.#translatorClient.getParticipants()));
            this.#clientTranslator.on('participant-left', () => this.setValue('participants', this.#translatorClient.getParticipants()));
            this.#clientTranslator.on('participant-updated', () => this.setValue('participants', this.#translatorClient.getParticipants()));
            this.#clientTranslator.on('left-meeting', () => this.setValue('participants', []));
        }
    }
}

export default new Translator();