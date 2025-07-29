import { LANG_KEYS, LOADER, SETTINGS_TYPES, TOAST_STYLE, TRANSCRIPT } from "../const";
import { Watcher } from "./Watcher";
import { toast } from 'sonner';
import { debugLog, generateCharString } from "../utils.js";
import { selectVirtualCableDevices, DeviceDetection, getTranslatorClient } from "translator-client";
import { getDailyManager } from "./DailyManager.js";
class IndexWatcher extends Watcher {
    #languages = [];
    #remoteLanguages = []; // Separate state for remote language selection
    #voices = [];
    #microphones = [];
    #cameras = [];
    #speakers = [];
    #speakersRemote = [];
    #isAppEnabled = true;
    #remoteSettings = {};
    #translatorClient = null;
    #selectedSpeakerId = 'default'; // Store the selected speaker ID
    #remoteDevices = {};
    #additionalParticipants = new Map(); // Store additional participants for demo
    #microphonesRemote = [];
    #demoAudioLoopActive = false;
    #clientSettings = {};

    constructor() {
        super();

        this.#languages = [];

        this.#voices = [];

        this.#microphones = [];
        this.#microphonesRemote = [];
        this.#cameras = [];
        this.#speakers = [];
        this.#speakersRemote = [];
        this.initTranslatorClient({
            baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:7860',
        });

        // Initialize shadow DOM for audio elements
        this.initAudioShadowDOM();

        this.refreshDevices();
        this.initVoices();
        this.initLanguages();
        this.initRemoteSettings();
        this.initClientSettings();

        // Check for auto-join parameters (for iframe participants)
        this.checkAutoJoin();

        // Set up cleanup on page unload
        this.setupCleanupOnUnload();
    }

    // Initialize shadow DOM for audio elements
    initAudioShadowDOM() {
        if (typeof window === 'undefined') return;

        // Check if shadow DOM is supported
        if (!document.body.attachShadow) {
            console.warn('🎵 Shadow DOM not supported, falling back to document body for audio elements');
            this.audioShadowRoot = null;
            this.audioContainer = null;
            return;
        }

        try {
            // Create a container element for the shadow DOM
            this.audioContainer = document.createElement('div');
            this.audioContainer.id = 'realtime-translate-audio-container';
            this.audioContainer.style.display = 'none';
            this.audioContainer.style.position = 'absolute';
            this.audioContainer.style.left = '-9999px';
            this.audioContainer.style.top = '-9999px';
            this.audioContainer.style.width = '1px';
            this.audioContainer.style.height = '1px';
            this.audioContainer.style.overflow = 'hidden';

            // Create shadow DOM
            this.audioShadowRoot = this.audioContainer.attachShadow({ mode: 'closed' });

            // Add the container to the document
            document.body.appendChild(this.audioContainer);

            console.log('🎵 Audio shadow DOM initialized');
        } catch (error) {
            console.warn('🎵 Failed to initialize shadow DOM, falling back to document body:', error);
            this.audioShadowRoot = null;
            this.audioContainer = null;
        }
    }

    // Set up cleanup when page is unloaded (refresh, close, etc.)
    setupCleanupOnUnload() {
        if (typeof window === 'undefined') return;

        const cleanup = () => {
            if (this.cleanupDemoAudio) {
                this.cleanupDemoAudio();
            }
            this.cleanupAudioMonitoring();
            this.cleanupAudioShadowDOM();
        };

        // Handle page unload events
        window.addEventListener('beforeunload', cleanup);
        window.addEventListener('unload', cleanup);
    }

    // Clean up audio shadow DOM
    cleanupAudioShadowDOM() {
        if (this.audioContainer && this.audioContainer.parentNode) {
            this.audioContainer.parentNode.removeChild(this.audioContainer);
            this.audioContainer = null;
            this.audioShadowRoot = null;
            console.log('🎵 Audio shadow DOM cleaned up');
        }
    }

    // NEW: Check for auto-join parameters and automatically join if needed
    checkAutoJoin() {
        if (typeof window === 'undefined') return;

        const urlParams = new URLSearchParams(window.location.search);
        const autoJoin = urlParams.get('autoJoin');
        const roomUrl = urlParams.get('roomUrl');
        const participantName = urlParams.get('participantName');
        const isDemo = urlParams.get('isDemo');

        if (autoJoin === 'true' && roomUrl && participantName) {


            // Set up the participant for auto-join
            this.setValue('roomUrl', roomUrl);
            this.setValue('currentName', participantName);
            this.setValue('isAppEnabled', true);
            this.#isAppEnabled = true;

            // Auto-join after a short delay to allow initialization
            setTimeout(async () => {
                try {
                    await this.joinRoom(); // Use regular joinRoom for iframe participants
                } catch (error) {
                    console.error('❌ Auto-join failed:', error);
                }
            }, 3000); // 3 second delay for initialization

            // Hide UI for demo participants
            if (isDemo === 'true') {
                document.body.style.display = 'none';
            }

            // Set up message listener for iframe participants to receive config changes
            this.setupIframeParticipantMessageListener();
        }
    }

    // NEW: Set up message listener for iframe participants to receive configuration changes
    setupIframeParticipantMessageListener() {
        if (typeof window === 'undefined') return;

        window.addEventListener('message', (event) => {
            const isElectron = typeof window !== 'undefined' &&
                (window.process?.type === 'renderer' ||
                    window.navigator?.userAgent?.includes('Electron') ||
                    window.location?.protocol === 'file:');

            if (!isElectron) {
                if (event.origin !== window.location.origin) return;
            }

            if (!event.data || typeof event.data !== 'object' || event.data.source !== 'realtime-translate') {
                return;
            }

            const { type, data } = event.data;

            switch (type) {
                case 'REMOTE_MICROPHONE_CHANGE':
                    if (data && data.microphoneId) {
                        this.applyMicrophoneChange(data.microphoneId);
                    }
                    break;

                case 'REMOTE_SPEAKER_CHANGE':
                    if (data && data.speakerId) {
                        this.applySpeakerChange(data.speakerId);
                    }
                    break;

                case 'REMOTE_VOLUME_CHANGE':
                    if (data && data.volume !== undefined) {
                        this.applyVolumeChange(data.volume, data.participantId);
                    }
                    break;

                case 'REMOTE_MUTE_CHANGE':
                    if (data && data.muted !== undefined) {
                        this.applyMuteChange(data.muted, data.participantId);
                    }
                    break;
                default:
                    break;
            }
        });
    }


    // NEW: Apply microphone change for iframe participant
    async applyMicrophoneChange(microphoneId) {
        try {
            // Update the microphone selection in this iframe participant
            this.#microphones.forEach(mic => mic.isSelected = mic.id === microphoneId);

            // Apply the device change if we're joined to a room
            if (this.getValue('isJoined') && this.#translatorClient) {
                await this.setInputDevicesAsync();
            } else {
            }
        } catch (error) {
            console.error('❌ Failed to apply microphone change in iframe participant:', error);
        }
    }

    // NEW: Apply speaker change for iframe participant
    async applySpeakerChange(speakerId) {
        try {
            // Update speaker selection
            this.#speakers.forEach(speaker => speaker.isSelected = speaker.id === speakerId);

            if (this.getValue('isJoined')) {
                const dailyManager = getDailyManager();
                const callObject = dailyManager.getCallObject();

                // Use Daily's API if available
                if (callObject && typeof callObject.setOutputDeviceAsync === 'function') {
                    try {
                        await callObject.setOutputDeviceAsync({
                            outputDeviceId: speakerId
                        });
                    } catch (dailyError) {
                        console.warn('Daily.co setOutputDeviceAsync failed:', dailyError);
                    }
                }

                // Also apply to DailyManager's audio elements
                const audioElements = dailyManager.audioElements;
                for (const [participantId, audioEl] of audioElements) {
                    if (audioEl.setSinkId) {
                        try {
                            await audioEl.setSinkId(speakerId);
                        } catch (err) {
                            console.warn(`Failed to set sink ID for participant ${participantId}:`, err);
                        }
                    }
                }
            }

            this.#selectedSpeakerId = speakerId;
        } catch (error) {
            console.error('Failed to apply speaker change:', error);
        }
    }


    initTranslatorClient(config) {
        if (!config) return;
        if (!config.baseUrl) return;

        // If there's an existing client, destroy it first
        if (this.#translatorClient) {
            try {
                this.#translatorClient.destroy();
            } catch (error) {
                // Ignore errors during destruction
            }
        }

        this.#translatorClient = getTranslatorClient(config);
    }

    get Languages() {
        return this.#languages;
    }

    get RemoteLanguages() {
        return this.#remoteLanguages;
    }

    get Voices() {
        return this.#voices;
    }

    get Microphones() {
        return this.#microphones;
    }

    get MicrophonesRemote() {
        return this.#microphonesRemote;
    }

    get Cameras() {
        return this.#cameras;
    }

    get Speakers() {
        return this.#speakers;
    }

    get SpeakersRemote() {
        return this.#speakersRemote;
    }

    get IsAppEnabled() {
        return this.#isAppEnabled;
    }

    get TranslatorClient() {
        return this.#translatorClient;
    }

    get RemoteSettings() {
        return this.#remoteSettings;
    }

    get RemoteDevices() {
        return this.#remoteDevices;
    }

    get ClientSettings() {
        return this.#clientSettings;
    }

    async initClientSettings() {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/settings`);
        if (!res.ok) {
            toast.error('Failed to fetch client settings', {
                style: TOAST_STYLE.ERROR
            });
            return;
        }
        const clientSettings = await res.json();
        this.#clientSettings = clientSettings.settings?.client_settings || clientSettings;
        this.notify('ClientSettings');
    }

    async initRemoteSettings() {
        if (!this.#translatorClient) {
            this.initTranslatorClient({
                baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:7860',
            });
        }
        const remoteSettings = await this.#translatorClient.fetchRemoteSettings();
        this.#remoteSettings = remoteSettings;

        this.#remoteDevices = await selectVirtualCableDevices(this.#remoteSettings?.input_name, this.#remoteSettings?.output_name, {
            video: false,
            audio: true
        });

        // Set remote device values based on remote settings
        if (this.#remoteDevices?.input?.id) {
            this.setValue('remoteMicrophone', this.#remoteDevices.input.id);
        }

        if (this.#remoteDevices?.output?.id) {
            this.setValue('remoteSpeaker', this.#remoteDevices.output.id);
        }

        // Note: Camera is not included in remote settings, so remoteCamera remains unset
        // and will use the first available camera by default

        this.notify('RemoteSettings');

        // Also notify device changes to update UI selections
        this.notify('MicrophonesRemote');
        this.notify('SpeakersRemote');
    }

    get AdditionalParticipants() {
        return this.#additionalParticipants;
    }

    async initVoices() {
        if (!this.#translatorClient) {
            this.initTranslatorClient({
                baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:7860',
            });
        }
        if (this.#voices.length > 0) return;
        const voices = await this.#translatorClient.fetchVoices();
        if (voices.length === 0) {
            toast.error('Failed to fetch voices', {
                style: TOAST_STYLE.ERROR
            });
            return;
        }

        this.#voices = voices.map(voice => ({
            id: voice.key,
            name: voice.name + ` (${voice.gender})`,
            isSelected: voice.key === 'aria'
        }));
        this.notify('Voices');
    }

    async initLanguages() {
        if (!this.#translatorClient) {
            this.initTranslatorClient({
                baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:7860',
            });
        }
        if (this.#languages.length > 0) return;
        const languages = await this.#translatorClient.fetchLanguages();
        // Initialize local languages (user's own language)
        this.#languages = languages.map(language => ({
            id: language.key,
            code: language.code,
            language: language.name,
            isSelected: language.key === 'english'
        }));

        // Initialize remote languages (separate selection state for remote participant)
        this.#remoteLanguages = languages.map(language => ({
            id: language.key,
            code: language.code,
            language: language.name,
            isSelected: language.key === 'english' // Default remote to different language
        }));

        this.notify('Languages');
        this.notify('RemoteLanguages');
    }

    async refreshDevices() {
        try {
            if (this.#microphones.length > 0) return;
            // First request permissions to access media devices
            const permissionGranted = await DeviceDetection.requestPermissions({
                video: false,
                audio: true
            });

            if (!permissionGranted) {
                toast.warning('Media device permissions are required to detect available devices', {
                    style: TOAST_STYLE.WARNING
                });
            }
            const devices = await DeviceDetection.getAllDevices();

            const currentMicId = this.#microphones.find(mic => mic.isSelected)?.id;
            const currentMicRemoteId = this.#microphonesRemote.find(mic => mic.isSelected)?.id;
            const currentCameraId = this.#cameras.find(cam => cam.isSelected)?.id;
            const currentSpeakerId = this.#speakers.find(speaker => speaker.isSelected)?.id;
            const currentSpeakerRemoteId = this.#speakersRemote.find(speaker => speaker.isSelected)?.id;

            // Get current remote device values from setValue
            const currentRemoteMicrophone = this.getValue('remoteMicrophone');
            const currentRemoteSpeaker = this.getValue('remoteSpeaker');
            const currentRemoteCamera = this.getValue('remoteCamera');

            this.#microphones = devices.microphones.map(mic => ({
                ...mic,
                isSelected: mic.id === currentMicId || (!currentMicId && mic.isSelected)
            }));

            this.#microphonesRemote = devices.microphones.map(mic => ({
                ...mic,
                isSelected: mic.id === currentRemoteMicrophone || mic.id === currentMicRemoteId || (!currentRemoteMicrophone && !currentMicRemoteId && mic.isSelected)
            }));

            this.#cameras = devices.cameras.map(cam => ({
                ...cam,
                isSelected: cam.id === currentRemoteCamera || cam.id === currentCameraId || (!currentRemoteCamera && !currentCameraId && cam.isSelected)
            }));

            this.#speakers = devices.speakers.map(speaker => ({
                ...speaker,
                isSelected: speaker.id === currentSpeakerId || (!currentSpeakerId && speaker.isSelected)
            }));

            this.#speakersRemote = devices.speakers.map(speaker => ({
                ...speaker,
                isSelected: speaker.id === currentRemoteSpeaker || speaker.id === currentSpeakerRemoteId || (!currentRemoteSpeaker && !currentSpeakerRemoteId && speaker.isSelected)
            }));

            this.notify('Devices');
            this.notify('MicrophonesRemote'); // Notify for remote microphones specifically
            this.notify('SpeakersRemote'); // Notify for remote speakers specifically
        } catch (error) {
            toast.error('Failed to refresh devices: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    updateLanguageSelection(language) {
        try {
            // Find and deselect currently selected language
            const selectedLanguage = this.#languages.find(lang => lang.isSelected);
            if (selectedLanguage) {
                selectedLanguage.isSelected = false;
            }

            // Select the new language
            language.isSelected = true;

            // Notify UI to update
            this.notify('Languages');

        } catch (error) {
            console.error('Error updating language selection:', error);
        }
    }

    setLanguages(key, language) {
        try {
            const dailyManager = getDailyManager();
            switch (key) {
                case LANG_KEYS.USER:
                    // Update local language selection state
                    const selectedLocalLanguage = this.#languages.find(lang => lang.isSelected);
                    if (selectedLocalLanguage) {
                        selectedLocalLanguage.isSelected = false;
                    }
                    const localLangToSelect = this.#languages.find(lang => lang.id === language.id);
                    if (localLangToSelect) {
                        localLangToSelect.isSelected = true;
                    }

                    this.setValue('currentUserLanguage', { id: language.id, name: language.language, code: language.code });
                    // For user language change, call setLanguage directly
                    const isJoined = this.getValue('isJoined');
                    if (isJoined && dailyManager) {
                        try {
                            dailyManager.setLanguage(language.id);
                            toast.success(`Language changed to ${language.language}`, {
                                style: TOAST_STYLE.SUCCESS
                            });
                        } catch (error) {
                            console.warn('Failed to set language on translator client:', error);
                            toast.error('Failed to change language', {
                                style: TOAST_STYLE.ERROR
                            });
                        }
                    }
                    this.notify('Languages');
                    break;
                case LANG_KEYS.CONTACT:
                    // Update remote language selection state (separate from local)
                    const selectedRemoteLanguage = this.#remoteLanguages.find(lang => lang.isSelected);
                    if (selectedRemoteLanguage) {
                        selectedRemoteLanguage.isSelected = false;
                    }
                    const remoteLangToSelect = this.#remoteLanguages.find(lang => lang.id === language.id);
                    if (remoteLangToSelect) {
                        remoteLangToSelect.isSelected = true;
                    }

                    this.setValue('currentContactLanguage', { id: language.id, name: language.language });
                    // For contact language change, use P2P system
                    const participants = this.getValue('participants') || [];

                    // Filter out bot participants (bots have names like "bot-username")
                    // We want the actual remote user participant, not the bot participants
                    const remoteUserParticipant = participants.find(p =>
                        !p.local &&
                        !p.user_name.startsWith('bot-') &&
                        p.user_name !== this.getValue('currentName')
                    );


                    if (remoteUserParticipant) {
                        this.requestRemoteLanguageChange(remoteUserParticipant.session_id, language.id);
                    } else {
                        toast.warning('No remote user participant found to change language', {
                            style: TOAST_STYLE.WARNING
                        });
                    }
                    this.notify('RemoteLanguages');
                    break;
                default:
                    toast.error('Invalid toggle key', {
                        style: TOAST_STYLE.ERROR
                    });
                    break;
            }
        } catch (error) {
            toast.error('Error setting languages' + error, {
                style: TOAST_STYLE.ERROR
            });
        }

    }

    // P2P Remote Settings Methods
    requestRemoteLanguageChange(remoteParticipantId, language) {
        try {
            if (!this.#translatorClient) {
                toast.error('Translator client not available', {
                    style: TOAST_STYLE.ERROR
                });
                return;
            }

            // this.#translatorClient.requestRemoteLanguageChange(remoteParticipantId, language);
            const dailyManager = getDailyManager();
            if (dailyManager && dailyManager.call) {
                dailyManager.call.sendAppMessage({
                    event_type: 'p2p_language_change_request',
                    target_participant_id: remoteParticipantId,
                    language: language,
                    timestamp: Date.now()
                }, remoteParticipantId); // Send only to target participant
            }
            toast.success(`Requested language change to ${language} for remote user`, {
                style: TOAST_STYLE.SUCCESS
            });
        } catch (error) {
            toast.error('Error requesting remote language change: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    requestRemoteVoiceChange(remoteParticipantId, voiceKey, targetLanguage) {
        try {
            if (!this.#translatorClient) {
                toast.error('Translator client not available', {
                    style: TOAST_STYLE.ERROR
                });
                return;
            }

            this.#translatorClient.requestRemoteVoiceChange(remoteParticipantId, voiceKey, targetLanguage);
            toast.success(`Requested voice change to ${voiceKey} for remote user`, {
                style: TOAST_STYLE.SUCCESS
            });
        } catch (error) {
            toast.error('Error requesting remote voice change: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    // Handle remote voice changes for contact settings
    handleRemoteVoiceChange(voiceKey) {
        try {
            const participants = this.getValue('participants') || [];

            // Filter out bot participants (bots have names like "bot-username")
            // We want the actual remote user participant, not the bot participants
            const remoteUserParticipant = participants.find(p =>
                !p.local &&
                !p.user_name.startsWith('bot-') &&
                p.user_name !== this.getValue('currentName')
            );

            if (remoteUserParticipant) {
                const remoteLanguage = this.getValue('currentContactLanguage')?.id || 'English';
                this.requestRemoteVoiceChange(remoteUserParticipant.session_id, voiceKey, remoteLanguage);
            } else {
                toast.warning('No remote user participant found to change voice', {
                    style: TOAST_STYLE.WARNING
                });
            }
        } catch (error) {
            toast.error('Error handling remote voice change: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    // Handle remote language changes for contact settings
    handleRemoteLanguageChange(languageKey) {
        try {
            const participants = this.getValue('participants') || [];

            // Filter out bot participants (bots have names like "bot-username")
            // We want the actual remote user participant, not the bot participants
            const remoteUserParticipant = participants.find(p =>
                !p.local &&
                !p.user_name.startsWith('bot-') &&
                p.user_name !== this.getValue('currentName')
            );

            if (remoteUserParticipant) {
                this.requestRemoteLanguageChange(remoteUserParticipant.session_id, languageKey);
            } else {
                toast.warning('No remote user participant found to change language', {
                    style: TOAST_STYLE.WARNING
                });
            }
        } catch (error) {
            toast.error('Error handling remote language change: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    async handleRoomSettings(key, value, participantId) {
        try {
            const dailyManager = getDailyManager();
            switch (key) {
                case SETTINGS_TYPES.VOICES:
                    this.#voices.forEach(voice => voice.isSelected = voice.id === value);
                    const selectedVoice = this.#voices.find(voice => voice.id === value);
                    toast.success('Voice changed to ' + selectedVoice.name, {
                        style: TOAST_STYLE.SUCCESS
                    });
                    const lang = this.getValue('currentUserLanguage') || { id: 'english', name: 'English', code: 'en-US' };
                    this.setValue('currentVoice', selectedVoice.id);
                    if (this.getValue('isJoined')) {
                        dailyManager.setVoice(selectedVoice.id, lang.id);
                    }
                    break;
                case SETTINGS_TYPES.MICROPHONES:
                    // First, update the selection
                    const selectedLocalMic = this.#microphones.find(mic => mic.isSelected);
                    if (selectedLocalMic) {
                        selectedLocalMic.isSelected = false;
                    }
                    const localMicToSelect = this.#microphones.find(mic => mic.id === value);
                    if (localMicToSelect) {
                        localMicToSelect.isSelected = true;
                    }

                    // Only try to set the device if we're joined to a room
                    if (this.getValue('isJoined') && this.#translatorClient) {
                        this.setInputDevicesAsync();
                        toast.success('Microphone changed to ' + localMicToSelect.name, {
                            style: TOAST_STYLE.SUCCESS
                        });
                    } else {
                        toast.success('Microphone changed to ' + localMicToSelect.name + ' (will apply when you join a room)', {
                            style: TOAST_STYLE.SUCCESS
                        });
                    }

                    this.notify('Microphones');
                    break;
                case SETTINGS_TYPES.CAMERAS:
                    this.#cameras.find(camera => camera.id === value).isSelected = true;
                    this.setInputDevicesAsync();
                    toast.success('Camera changed to ' + value, {
                        style: TOAST_STYLE.SUCCESS
                    });
                    break;
                case SETTINGS_TYPES.SPEAKERS:
                    await this.setLocalSpeaker(value);
                    // const selectedSpeaker = this.#speakers.find(speaker => speaker.id === value);
                    const selectedLocalSpeaker = this.#speakers.find(speaker => speaker.isSelected);
                    if (selectedLocalSpeaker) {
                        selectedLocalSpeaker.isSelected = false;
                    }
                    const localSpeakerToSelect = this.#speakers.find(speaker => speaker.id === value);
                    if (localSpeakerToSelect) {
                        localSpeakerToSelect.isSelected = true;
                    }
                    // this.setOutputDevicesAsync();
                    toast.success('Local speaker changed to ' + localSpeakerToSelect.name, {
                        style: TOAST_STYLE.SUCCESS
                    });
                    this.notify('Speakers');
                    break;
                case "remoteMicrophone":
                    // First, update the selection state
                    this.#microphonesRemote.forEach(mic => mic.isSelected = mic.id === value);
                    const selectedRemoteMic = this.#microphonesRemote.find(mic => mic.id === value);

                    // Send change to iframe participant
                    this.sendMicrophoneChangeToRemote(value);
                    this.setValue('remoteMicrophone', value);
                    toast.success('Remote microphone changed to ' + selectedRemoteMic.name, {
                        style: TOAST_STYLE.SUCCESS
                    });
                    break;
                case "remoteSpeaker":
                    await this.setRemoteSpeaker(value);
                    const selectedRemoteSpeaker = this.#speakersRemote.find(speaker => speaker.id === value);
                    this.setValue('remoteSpeaker', value);
                    toast.success('Remote speaker changed to ' + selectedRemoteSpeaker.name, {
                        style: TOAST_STYLE.SUCCESS
                    });
                    break;
                case "remoteVolume":
                    // If participantId is provided, validate it exists
                    if (participantId) {
                        const client = this.TranslatorClient;
                        const allParticipants = client.getParticipants();
                        const participantExists = allParticipants.some(p => p.session_id === participantId);

                        if (!participantExists) {
                            console.error(`Participant ${participantId} not found in participants list`);
                            toast.error(`Participant not found`, {
                                style: TOAST_STYLE.ERROR
                            });
                            return;
                        }
                    }

                    // Set volume for specific participant or all iframe participants
                    if (participantId) {
                        await this.setRemoteParticipantVolume(participantId, value);
                    } else {
                        // If no participantId provided, apply to all iframe participants
                        const iframeParticipants = this.getIframeParticipants();
                        for (const participant of iframeParticipants) {
                            await this.setRemoteParticipantVolume(participant.id, value);
                        }
                    }
                    break;

                case "remoteMute":
                    // If participantId is provided, validate it exists
                    if (participantId) {
                        const client = this.TranslatorClient;
                        const allParticipants = client.getParticipants();
                        const participantExists = allParticipants.some(p => p.session_id === participantId);

                        if (!participantExists) {
                            console.error(`Participant ${participantId} not found in participants list`);
                            toast.error(`Participant not found`, {
                                style: TOAST_STYLE.ERROR
                            });
                            return;
                        }
                    }

                    // Mute/unmute specific participant or all iframe participants
                    if (participantId) {
                        await this.muteRemoteParticipantIframe(participantId, value);
                    } else {
                        // If no participantId provided, apply to all iframe participants
                        const allParticipants = this.getIframeParticipants();
                        for (const participant of allParticipants) {
                            await this.muteRemoteParticipantIframe(participant.id, value);
                        }
                    }
                    break;
                default:
                    toast.error('Invalid key', {
                        style: TOAST_STYLE.ERROR
                    });
                    break;
            }
        } catch (error) {
            toast.error('Error handling room settings' + error, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    // NEW: Get appropriate target origin for postMessage in Electron apps
    getPostMessageTargetOrigin() {
        // Check if we're in Electron
        const isElectron = typeof window !== 'undefined' &&
            (window.process?.type === 'renderer' ||
                window.navigator?.userAgent?.includes('Electron') ||
                window.location?.protocol === 'file:');

        if (isElectron) {
            // In Electron, use "*" for cross-origin iframe communication
            // This is acceptable since we control both the main window and iframe
            return "*";
        } else {
            // In browser environments, use the proper origin for security
            return window.location.origin;
        }
    }

    // NEW: Send microphone change to remote iframe participant
    sendMicrophoneChangeToRemote(microphoneId) {
        if (this.#additionalParticipants.size === 0) {
            console.warn('No additional participants to send microphone change to');
            return;
        }

        const message = {
            source: 'realtime-translate',
            type: 'REMOTE_MICROPHONE_CHANGE',
            data: { microphoneId: microphoneId },
            timestamp: Date.now()
        };

        const targetOrigin = this.getPostMessageTargetOrigin();

        for (const [participantId, participantData] of this.#additionalParticipants) {
            if (participantData.type === 'iframe' && participantData.iframe) {
                try {
                    participantData.iframe.contentWindow.postMessage(message, targetOrigin);
                } catch (error) {
                    console.error(`Failed to send microphone change to iframe participant ${participantId}:`, error);
                }
            }
        }
    }

    // NEW: Send speaker change to remote iframe participant
    sendSpeakerChangeToRemote(speakerId) {
        if (this.#additionalParticipants.size === 0) {
            console.warn('No additional participants to send speaker change to');
            return;
        }

        const message = {
            source: 'realtime-translate',
            type: 'REMOTE_SPEAKER_CHANGE',
            data: { speakerId: speakerId },
            timestamp: Date.now()
        };

        const targetOrigin = this.getPostMessageTargetOrigin();

        for (const [participantId, participantData] of this.#additionalParticipants) {
            if (participantData.type === 'iframe' && participantData.iframe) {
                try {
                    participantData.iframe.contentWindow.postMessage(message, targetOrigin);
                } catch (error) {
                    console.error(`Failed to send speaker change to iframe participant ${participantId}:`, error);
                }
            }
        }
    }

    getParticipantsFromDaily() {
        const dailyManager = getDailyManager();
        const callState = dailyManager.getCallState();
        return callState ? callState.participants : [];
    }

    async joinRoom() {
        try {
            this.setValue(LOADER.ROOM, true);
            // generate room
            let roomUrl = this.getValue('roomUrl') || generateCharString(50);

            // check if roomId is url
            if (roomUrl.includes('http')) roomUrl = roomUrl.split('/').pop();

            const currentName = this.getValue('currentName') || 'Guest' + Math.random().toString(36).substring(2, 15);
            const language = this.getValue('currentUserLanguage')?.id || 'english';
            const voice = this.getValue('currentVoice') || this.#voices[0].id;

            if (!roomUrl) {
                toast.error('Room ID is required', {
                    style: TOAST_STYLE.ERROR
                });
                this.setValue(LOADER.ROOM, false);
                return;
            }

            // Reinitialize translator client if needed
            if (!this.#translatorClient) {
                this.initTranslatorClient({
                    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:7860',
                });

                if (!this.#translatorClient) {
                    toast.error('Failed to initialize translator client', {
                        style: TOAST_STYLE.ERROR
                    });
                    this.setValue(LOADER.ROOM, false);
                    return;
                }
            }

            const isDemoParticipant = this.getValue('currentName')?.includes('_Demo') ||
                new URLSearchParams(window.location.search).get('isDemo') === 'true';

            this.#demoAudioLoopActive = true;

            // Helper method to create TTS audio element
            const createTTSAudio = async (text, elementId, speakerId = null) => {
                try {
                    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/tts/speak`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text, language, voice })
                    });
                    if (!response.ok) throw new Error('TTS generation failed');

                    const audioBlob = await response.blob();
                    const audioUrl = URL.createObjectURL(audioBlob);

                    const audio = document.createElement('audio');
                    audio.setAttribute('id', elementId);
                    audio.src = audioUrl;

                    // Add audio element to shadow DOM instead of document body
                    if (this.audioShadowRoot) {
                        this.audioShadowRoot.appendChild(audio);
                    } else {
                        // Fallback to document body if shadow DOM is not available
                        document.body.appendChild(audio);
                    }

                    // Wait for the speaker to be applied before returning
                    await this.applySpeakerToElement(audio, speakerId);

                    return audio;
                } catch (error) {
                    console.error(`Failed to create TTS audio for ${elementId}:`, error);
                    return null;
                }
            };

            // Helper method to create hold music audio element
            const createHoldMusicAudio = async (elementId, speakerId = null) => {
                try {
                    // Create audio element immediately with the streaming URL
                    const audio = document.createElement('audio');
                    audio.setAttribute('id', elementId);
                    // audio.src = `${import.meta.env.VITE_API_BASE_URL}/assets/hold-music.mp3`;
                    audio.src = `${import.meta.env.VITE_API_BASE_URL}/assets/hold-music.mp3`;

                    // Add audio element to shadow DOM instead of document body
                    if (this.audioShadowRoot) {
                        this.audioShadowRoot.appendChild(audio);
                    } else {
                        // Fallback to document body if shadow DOM is not available
                        document.body.appendChild(audio);
                    }

                    // Apply speaker without waiting for full load
                    this.applySpeakerToElement(audio, speakerId).catch(error => {
                        console.warn(`Failed to apply speaker to hold music:`, error);
                    });

                    return audio;
                } catch (error) {
                    console.error(`Failed to create hold music audio for ${elementId}:`, error);
                    return null;
                }
            };

            const setupAgentAudio = async () => {
                try {
                    const startText = this.ClientSettings?.ivr_messages?.agent?.start || 'Hold one second connecting you to the customer';

                    const selectedSpeaker = this.#speakers.find(speaker => speaker.isSelected);
                    let selectedSpeakerId = selectedSpeaker ? selectedSpeaker.id : null;

                    // Create both start message and hold music in parallel
                    const [agentStartAudio, agentHoldMusic] = await Promise.all([
                        createTTSAudio(startText, 'ivr-audio-agent', selectedSpeakerId),
                        createHoldMusicAudio('ivr-hold-music-agent', selectedSpeakerId)
                    ]);

                    if (agentStartAudio && agentHoldMusic) {
                        const participants = this.getParticipantsFromDaily();
                        if (participants.length >= 4) return;


                        // Set up transition to hold music after start message ends
                        agentStartAudio.addEventListener('ended', () => {
                            if (this.#demoAudioLoopActive) {
                                agentHoldMusic.play().catch(e => console.warn('Hold music autoplay failed:', e));
                            }
                        });

                        // Set up hold music loop
                        agentHoldMusic.addEventListener('ended', () => {
                            if (this.#demoAudioLoopActive) {
                                agentHoldMusic.play().catch(e => console.warn('Hold music replay failed:', e));
                            }
                        });

                        // Play start message first
                        agentStartAudio.play().catch(e => console.warn('Autoplay failed:', e));
                    }

                } catch (error) {
                    console.error('Agent audio setup error:', error);
                }
            };

            const setupDemoAudio = async () => {
                try {
                    const startText = this.ClientSettings?.ivr_messages?.consumer?.start || 'Hold one second connecting you to an agent';

                    // Create both start message and hold music in parallel
                    const [demoStartAudio, demoHoldMusic] = await Promise.all([
                        createTTSAudio(startText, 'ivr-audio', this.getValue('remoteSpeaker')),
                        createHoldMusicAudio('ivr-hold-music', this.getValue('remoteSpeaker'))
                    ]);


                    // Set up transition to hold music after start message ends
                    const demoAudioEndedHandler = () => {
                        if (this.#demoAudioLoopActive && demoHoldMusic) {
                            demoHoldMusic.play().catch(e => console.warn('Hold music autoplay failed:', e));
                        }
                    };
                    demoStartAudio.addEventListener('ended', demoAudioEndedHandler);

                    // Set up hold music loop
                    const demoHoldMusicEndedHandler = () => {
                        if (this.#demoAudioLoopActive && demoHoldMusic) {
                            demoHoldMusic.play().catch(e => console.warn('Hold music replay failed:', e));
                        }
                    };

                    demoHoldMusic.addEventListener('ended', demoHoldMusicEndedHandler);
                    if (this.#demoAudioLoopActive) {
                        demoStartAudio.play().catch(e => console.warn('Autoplay failed:', e));
                    }
                } catch (error) {
                    console.error('Demo audio loading error:', error);
                }
            };

            // Enhanced cleanup logic to handle early termination
            this.cleanupDemoAudio = () => {
                console.log('🧹 Cleaning up demo audio...');
                // Stop the loop immediately
                this.#demoAudioLoopActive = false;

                // Clear any pending timeouts
                if (this.audioLoopTimeout) {
                    clearTimeout(this.audioLoopTimeout);
                    this.audioLoopTimeout = null;
                }

                // Clean up any IVR audio elements that might still be playing
                // First try to find elements in shadow DOM
                let ivrElements = [];
                if (this.audioShadowRoot) {
                    ivrElements = this.audioShadowRoot.querySelectorAll('#ivr-audio, #ivr-audio-agent, #ivr-audio-end, #ivr-audio-agent-end, #ivr-hold-music, #ivr-hold-music-agent');
                }

                // Fallback to document body if not found in shadow DOM
                if (ivrElements.length === 0) {
                    ivrElements = document.querySelectorAll('#ivr-audio, #ivr-audio-agent, #ivr-audio-end, #ivr-audio-agent-end, #ivr-hold-music, #ivr-hold-music-agent');
                }

                ivrElements.forEach(element => {
                    try {
                        element.pause();
                        element.remove();
                    } catch (error) {
                        console.warn('Error cleaning up IVR element:', error);
                    }
                });

                console.log('✅ Demo audio cleanup completed');
            };

            // Load both agent and demo audio for non-demo participants
            if (!isDemoParticipant) {
                await setupAgentAudio();
                await setupDemoAudio();
            } else {
            }

            // Start bot and get room details
            const data = await this.#translatorClient.startBot(currentName, language, roomUrl, voice, true);

            if (data.room_url && data.userName) {
                this.setValue('roomUrl', data.room_url);

                // Use DailyManager to join room
                const dailyManager = getDailyManager();
                await dailyManager.joinRoom(data.room_url, data.userName);

                this.setValue('isJoined', true);
                this.setValue('localSessionId', data.userName);

                // Listen to DailyManager events
                dailyManager.on('participant-joined', async (event) => {
                    this.setValue('participants', this.getParticipantsFromDaily());
                    const participants = this.getParticipantsFromDaily();
                    if (participants.length >= 4) {
                        // Stop all audio loops
                        this.#demoAudioLoopActive = false;

                        // Stop and clean up start messages and hold music
                        // Try to find elements in shadow DOM first
                        let audio = null;
                        let audioAgent = null;
                        let holdMusic = null;
                        let holdMusicAgent = null;

                        if (this.audioShadowRoot) {
                            audio = this.audioShadowRoot.getElementById('ivr-audio');
                            audioAgent = this.audioShadowRoot.getElementById('ivr-audio-agent');
                            holdMusic = this.audioShadowRoot.getElementById('ivr-hold-music');
                            holdMusicAgent = this.audioShadowRoot.getElementById('ivr-hold-music-agent');
                        }

                        // Fallback to document body if not found in shadow DOM
                        if (!audio) audio = document.getElementById('ivr-audio');
                        if (!audioAgent) audioAgent = document.getElementById('ivr-audio-agent');
                        if (!holdMusic) holdMusic = document.getElementById('ivr-hold-music');
                        if (!holdMusicAgent) holdMusicAgent = document.getElementById('ivr-hold-music-agent');

                        if (audio) {
                            audio.pause();
                            audio.remove();
                        }
                        if (audioAgent) {
                            audioAgent.pause();
                            audioAgent.remove();
                        }
                        if (holdMusic) {
                            holdMusic.pause();
                            holdMusic.remove();
                        }
                        if (holdMusicAgent) {
                            holdMusicAgent.pause();
                            holdMusicAgent.remove();
                        }
                    }
                });

                dailyManager.on('participant-updated', (event) => {
                    this.setValue('participants', this.getParticipantsFromDaily());
                    this.handleParticipantUpdate();
                });

                dailyManager.on('participant-left', (event) => {
                    this.setValue('participants', this.getParticipantsFromDaily());
                    this.cleanupDemoAudio();
                });

                dailyManager.on('app-message', (event) => {
                    this.handleAppMessage(event);
                });
            }

            // Apply selected input devices after joining
            setTimeout(() => {
                this.setInputDevicesAsync();
                this.syncMediaStateWithDaily();

                // Handle iframe participants
                const isDemoParticipant = this.getValue('currentName')?.includes('_Demo') ||
                    new URLSearchParams(window.location.search).get('isDemo') === 'true';

                if (isDemoParticipant) {
                    const remoteMicrophone = this.getValue('remoteMicrophone');
                    const remoteSpeaker = this.getValue('remoteSpeaker');

                    if (remoteMicrophone) {
                        this.applyMicrophoneChange(remoteMicrophone);
                    }
                    if (remoteSpeaker) {
                        this.applySpeakerChange(remoteSpeaker);
                    }
                }
            }, 1000);

            this.setValue(LOADER.ROOM, false);
        } catch (error) {
            toast.error('Error joining room: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
            this.setValue(LOADER.ROOM, false);
        }
    }

    handleAppMessage(event) {
        const { data, fromId } = event;
        const dailyManager = getDailyManager();
        if (data) {
            switch (data.event_type) {
                case 'language_detected':
                    // Handle language detection
                    if (data.language) {
                        const language = this.#languages.find(lang =>
                            lang.language.toLowerCase() === data.language.toLowerCase()
                        );
                        if (language) {
                            this.updateLanguageSelection(language);
                            toast.success(`Language detected: ${language.language}`, {
                                style: TOAST_STYLE.SUCCESS
                            });
                        }
                    }
                    break;

                case 'update_language':
                    // Handle language updates
                    const participants = this.getParticipantsFromDaily();
                    const participant = participants.find(p => p.session_id === data.participant_id);
                    if (participant && participant.user_name === this.getValue('localSessionId')) {
                        const selectedLanguage = this.#languages.find(lang =>
                            lang.language.toLowerCase() === data.language.toLowerCase()
                        );
                        if (selectedLanguage) {
                            this.setValue('currentUserLanguage', selectedLanguage);
                        }
                    }
                    break;

                case 'p2p_language_change_request':
                case 'p2p_voice_change_request':
                    // Handle P2P requests
                    if (dailyManager) {
                        dailyManager.handleP2PMessage(data, fromId);
                    }
                    break;

                default:
                    break;
            }
        }
    }


    // NEW: Join room with additional participants using iframe approach
    async joinRoomWithAdditionalParticipants(additionalCount = 1) {
        try {
            // First, join normally with main participant
            await this.joinRoom();

            // Wait a bit for main participant to be established
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Then create additional participants using iframe approach
            const roomUrl = this.getValue('roomUrl');
            const baseName = this.getValue('currentName') || 'Guest';

            if (!roomUrl) {
                toast.error('Room URL is required for additional participants', {
                    style: TOAST_STYLE.ERROR
                });
                return;
            }

            for (let i = 1; i <= additionalCount; i++) {
                try {
                    const participantName = `${baseName}_Demo${i}`;
                    const iframeId = `demo-participant-${i}`;

                    // Create hidden iframe for additional participant
                    const iframe = document.createElement('iframe');
                    iframe.id = iframeId;
                    iframe.style.display = 'none';
                    iframe.style.position = 'absolute';
                    iframe.style.left = '-9999px';
                    iframe.style.width = '1px';
                    iframe.style.height = '1px';
                    iframe.setAttribute('allow', 'microphone; camera; autoplay; display-capture');

                    // Create URL with auto-join parameters
                    const currentUrl = new URL(window.location.href);

                    // Check if we're in Electron environment
                    const isElectron = typeof window !== 'undefined' &&
                        (window.process?.type === 'renderer' ||
                            window.navigator?.userAgent?.includes('Electron') ||
                            window.location?.protocol === 'file:');

                    let iframeUrl;
                    if (isElectron) {
                        // In Electron, use the full current URL and replace query parameters
                        iframeUrl = new URL(currentUrl.href);
                        // Clear existing search params and set new ones
                        iframeUrl.search = '';
                    } else {
                        // In browser environments, use origin-based approach
                        iframeUrl = new URL(currentUrl.origin);
                    }

                    iframeUrl.searchParams.set('autoJoin', 'true');
                    iframeUrl.searchParams.set('roomUrl', roomUrl);
                    iframeUrl.searchParams.set('participantName', participantName);
                    iframeUrl.searchParams.set('isDemo', 'true');

                    iframe.src = iframeUrl.toString();
                    const dailyManager = getDailyManager();
                    dailyManager.setIframeCallObject(iframe);

                    // Wait for iframe to load and join
                    const loadPromise = new Promise((resolve, reject) => {
                        iframe.onload = () => {
                            resolve();
                        };
                        iframe.onerror = () => {
                            reject(new Error(`Failed to load iframe for participant ${i}`));
                        };
                    });

                    document.body.appendChild(iframe);
                    await loadPromise;

                    // Store iframe reference for cleanup
                    this.#additionalParticipants.set(`demo_${i}`, {
                        iframe: iframe,
                        participantName: participantName,
                        iframeId: iframeId,
                        type: 'iframe'
                    });

                    // Send current remote device settings to the iframe participant
                    setTimeout(() => {
                        const remoteMicrophone = this.getValue('remoteMicrophone');
                        const remoteSpeaker = this.getValue('remoteSpeaker');

                        if (remoteMicrophone) {
                            this.sendMicrophoneChangeToRemote(remoteMicrophone);
                        }
                        if (remoteSpeaker) {
                            this.sendSpeakerChangeToRemote(remoteSpeaker);
                        }
                    }, 2000); // Wait 2 seconds for iframe to fully initialize

                } catch (error) {
                    console.error(`Failed to create additional participant ${i}:`, error);
                    toast.error(`Failed to create participant ${i}: ${error.message}`, {
                        style: TOAST_STYLE.ERROR
                    });
                }
            }

            const successCount = this.#additionalParticipants.size;
            if (successCount > 0) {
                toast.success(`✅ Created ${successCount} additional participants`, {
                    style: TOAST_STYLE.SUCCESS
                });
            }

        } catch (error) {
            toast.error('Error creating additional participants: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    /**
     * Sync UI media state with actual Daily.co state after joining
     */
    syncMediaStateWithDaily() {
        const dailyManager = getDailyManager();
        const callObject = dailyManager.getCallObject();

        if (!callObject) {
            console.warn('Cannot sync media state: CallObject not available');
            return;
        }

        try {
            const callState = dailyManager.getCallState();
            if (callState) {
                this.setValue('isMicOn', callState.localAudio);
                this.setValue('isVideoOn', false); // Always false for audio-only
            }
        } catch (error) {
            console.error('Failed to sync media state with Daily.co:', error);
        }
    }


    async leaveRoom() {
        try {
            this.setValue(LOADER.ROOM, true);

            // Clean up audio monitoring intervals
            this.cleanupAudioMonitoring();

            this.cleanupDemoAudio();

            // Clean up additional participants
            await this.cleanupAdditionalParticipants();

            // Leave room using DailyManager
            const dailyManager = getDailyManager();
            await dailyManager.leaveRoom();

            if (this.#translatorClient) {
                this.#translatorClient.destroy();
                this.#translatorClient = null;
            }

            this.setValue('isJoined', false);
            this.setValue('roomId', '');
            this.setValue('participants', []);
            this.setValue('isMicOn', true);
            this.setValue('isVideoOn', false);
            this.setValue(LOADER.ROOM, false);
            toast.info('Left room');
            // window.location.reload();
        } catch (error) {
            toast.error('Error leaving room: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });

            // Clean up even if error
            await this.cleanupAdditionalParticipants();

            const dailyManager = getDailyManager();
            if (dailyManager) {
                await dailyManager.leaveRoom();
            }

            if (this.#translatorClient) {
                this.#translatorClient.destroy();
                this.#translatorClient = null;
            }

            this.setValue('isJoined', false);
            this.setValue('roomId', '');
            this.setValue('participants', []);
            this.setValue(LOADER.ROOM, false);
        }
    }

    // Updated: Clean up additional participants (iframe approach)
    async cleanupAdditionalParticipants() {
        if (this.#additionalParticipants.size === 0) return;

        for (const [participantId, participantData] of this.#additionalParticipants) {
            try {
                if (participantData.type === 'iframe' && participantData.iframe) {
                    // Remove iframe from DOM
                    participantData.iframe.remove();
                } else if (participantData.client) {
                    // Fallback for old client-based approach
                    await participantData.client.leaveRoom();
                    participantData.client.destroy();
                }
            } catch (error) {
                console.error(`Failed to cleanup participant ${participantId}:`, error);
            }
        }

        this.#additionalParticipants.clear();
    }

    /**
      * Clean up all audio monitoring intervals
      */
    cleanupAudioMonitoring() {
        if (this.sinkIdInterval) {
            clearInterval(this.sinkIdInterval);
            this.sinkIdInterval = null;
        }
        if (this.localSinkIdInterval) {
            clearInterval(this.localSinkIdInterval);
            this.localSinkIdInterval = null;
        }
        if (this.remoteSinkIdInterval) {
            clearInterval(this.remoteSinkIdInterval);
            this.remoteSinkIdInterval = null;
        }
        if (this.outputDeviceMonitor) {
            clearInterval(this.outputDeviceMonitor);
            this.outputDeviceMonitor = null;
        }
    }
    handleMic(value) {
        try {
            if (this.getValue('isJoined')) {
                const dailyManager = getDailyManager();
                const actualAudioState = dailyManager.toggleAudio();
                this.setValue('isMicOn', actualAudioState);
            } else {
                this.setValue('isMicOn', value);
            }
        } catch (error) {
            toast.error('Error handling mic: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }
    /**
    * Set input devices on the call object (Daily.co) if available
    */
    async setInputDevicesAsync() {
        if (!this.#isAppEnabled) {
            console.warn('App is not enabled, skipping device setting');
            return;
        }

        if (!this.getValue('isJoined')) {
            console.warn('Not joined to a room, skipping device setting');
            return;
        }

        const dailyManager = getDailyManager();
        const callObject = dailyManager.getCallObject();

        if (!callObject) {
            console.warn('Daily call object not available, skipping device setting');
            return;
        }

        try {
            const selectedMic = this.#microphones.find(mic => mic.isSelected);
            const selectedCam = this.#cameras.find(cam => cam.isSelected);

            await callObject.setInputDevicesAsync({
                audioDeviceId: selectedMic ? selectedMic.id : undefined,
                videoDeviceId: selectedCam ? selectedCam.id : undefined
            });
        } catch (error) {
            console.error('Failed to set input devices:', error);
            toast.error('Failed to change microphone: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    setParticipantVolume(participantId, volume) {
        const dailyManager = getDailyManager();
        dailyManager.setParticipantVolume(participantId, volume);
    }



    /**
 * Helper method to apply sink ID to a specific element with retry logic
 */
    async applySinkIdToElement(element, sinkId = null) {
        const targetSinkId = sinkId || this.#selectedSpeakerId;
        if (!targetSinkId || targetSinkId === 'default') return;

        // Check if element is Daily.co managed (these often cause conflicts)
        const isDailyElement = element.id && (element.id.includes('daily') || element.id.includes('audio-'));
        const isOurElement = element.getAttribute('data-participant-id') || element.style.display === 'none';

        try {
            if (typeof element.setSinkId === 'function') {
                // Check if sink ID is already set to avoid unnecessary calls
                if (element.sinkId === targetSinkId) {
                    return;
                }

                // For Daily.co elements, try to use their API first
                if (isDailyElement && this.#translatorClient && this.#translatorClient.CallObject) {
                    try {
                        await this.#translatorClient.CallObject.setOutputDeviceAsync({
                            outputDeviceId: targetSinkId
                        });
                        return;
                    } catch (dailyError) {
                        console.warn('Daily.co API failed, falling back to setSinkId:', dailyError);
                    }
                }

                // Apply setSinkId with retry logic for AbortError
                await this.setSinkIdWithRetry(element, targetSinkId);
            } else {
                console.warn('setSinkId not supported for element:', element);
            }
        } catch (error) {
            console.warn(`Failed to set sinkId to ${targetSinkId} for element:`, error);
        }
    }

    /**
     * Helper method to set sink ID with retry logic for AbortError
     */
    async setSinkIdWithRetry(element, sinkId, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Wait a bit before each attempt to let any ongoing operations complete
                if (attempt > 1) {
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                }

                await element.setSinkId(sinkId);
                return; // Success
            } catch (error) {
                if (error.name === 'AbortError' && attempt < maxRetries) {
                    continue;
                } else {
                    throw error; // Re-throw if not AbortError or max retries reached
                }
            }
        }
    }

    /**
     * Helper method to apply sink ID to all media elements
     */
    async applySinkIdToAllMedia() {
        if (!this.#selectedSpeakerId || this.#selectedSpeakerId === 'default') return;

        try {
            const videoElements = document.querySelectorAll('video');
            const audioElements = document.querySelectorAll('audio');
            const allElements = [...videoElements, ...audioElements].filter(element => !element.id.includes('ivr'));

            const promises = allElements.map(element => this.applySinkIdToElement(element));
            await Promise.all(promises);
        } catch (error) {
            console.error('Failed to apply sinkId to all media elements:', error);
        }
    }

    /**
     * Set output devices using Daily.co API first, then fallback to manual setSinkId
     */
    async setOutputDevicesAsync() {
        try {
            const selectedSpeaker = this.#speakers.find(speaker => speaker.isSelected);
            if (!selectedSpeaker) {
                console.warn('No speaker selected');
                return;
            }

            // Store the selected speaker ID
            this.#selectedSpeakerId = selectedSpeaker.id;

            // First, try to use Daily.co's official API if available
            if (this.#translatorClient && this.#translatorClient.CallObject) {

                // Check if the method exists
                if (typeof this.#translatorClient.CallObject.setOutputDeviceAsync === 'function') {
                    try {
                        // Get current output device for comparison
                        let currentDevice = 'unknown';
                        try {
                            const currentDevices = await this.#translatorClient.CallObject.getOutputDeviceAsync();
                            currentDevice = currentDevices.outputDeviceId || 'default';
                        } catch (e) {
                            console.warn('Could not get current Daily.co output device:', e);
                        }

                        // Set the new output device
                        await this.#translatorClient.CallObject.setOutputDeviceAsync({
                            outputDeviceId: selectedSpeaker.id
                        });

                        // Verify it was set correctly
                        setTimeout(async () => {
                            try {
                                const verifyDevices = await this.#translatorClient.CallObject.getOutputDeviceAsync();
                                if (verifyDevices.outputDeviceId !== selectedSpeaker.id) {
                                    console.warn('Daily.co output device verification failed! Expected:', selectedSpeaker.id, 'Got:', verifyDevices.outputDeviceId);
                                }
                            } catch (e) {
                                console.warn('Could not verify Daily.co output device:', e);
                            }
                        }, 1000);

                        // Still apply to our custom elements that Daily.co doesn't manage
                        await this.applySinkIdToCustomElements();

                        // Monitor for Daily.co reverting the device
                        this.monitorDailyOutputDevice();

                    } catch (dailyError) {
                        console.warn('Daily.co setOutputDeviceAsync failed:', dailyError);
                        await this.applySinkIdToAllMedia();
                    }
                } else {
                    await this.applySinkIdToAllMedia();
                }
            } else {
                // Fallback to manual setSinkId for all elements
                await this.applySinkIdToAllMedia();
            }

            // Schedule periodic re-application to handle newly created elements
            this.schedulePeriodicSinkIdApplication();

        } catch (error) {
            console.error('Failed to set output devices:', error);
            toast.error('Failed to change speaker: ' + error.message, {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    /**
     * Apply sink ID only to custom elements (not Daily.co managed ones)
     */
    async applySinkIdToCustomElements() {
        if (!this.#selectedSpeakerId || this.#selectedSpeakerId === 'default') return;

        try {
            const videoElements = document.querySelectorAll('video');
            const audioElements = document.querySelectorAll('audio');
            const allElements = [...videoElements, ...audioElements].filter(element => !element.id.includes('ivr'));

            // Filter to only our custom elements
            const customElements = allElements.filter(element => {
                const isDailyElement = element.id && (element.id.includes('daily') || element.id.includes('audio-'));
                const isOurElement = element.getAttribute('data-participant-id') ||
                    element.style.display === 'none' ||
                    element.classList.contains('video-element');

                return isOurElement && !isDailyElement;
            });

            const promises = customElements.map(element => this.applySinkIdToElement(element));
            await Promise.all(promises);

        } catch (error) {
            console.error('Failed to apply sinkId to custom elements:', error);
        }
    }

    /**
     * Monitor Daily.co output device to detect when it changes back
     */
    monitorDailyOutputDevice() {
        if (!this.#translatorClient || !this.#translatorClient.CallObject) return;

        // Clear any existing monitor
        if (this.outputDeviceMonitor) {
            clearInterval(this.outputDeviceMonitor);
        }

        // Check every 3 seconds if Daily.co has changed the output device
        this.outputDeviceMonitor = setInterval(async () => {
            try {
                const currentDevices = await this.#translatorClient.CallObject.getOutputDeviceAsync();
                if (currentDevices.outputDeviceId !== this.#selectedSpeakerId) {
                    await this.#translatorClient.CallObject.setOutputDeviceAsync({
                        outputDeviceId: this.#selectedSpeakerId
                    });
                }
            } catch (error) {
                console.warn('Failed to monitor Daily.co output device:', error);
            }
        }, 3000);

        // Stop monitoring after 30 seconds
        setTimeout(() => {
            if (this.outputDeviceMonitor) {
                clearInterval(this.outputDeviceMonitor);
                this.outputDeviceMonitor = null;
            }
        }, 30000);
    }

    /**
     * Schedule periodic re-application of sink ID for specific participant types only
     */
    schedulePeriodicSinkIdApplicationForParticipantTypes(participantTypes, speakerId) {
        // Use different interval names for local vs remote to prevent conflicts
        const intervalName = participantTypes.includes('local') ? 'localSinkIdInterval' : 'remoteSinkIdInterval';

        // Clear any existing interval for this participant type
        if (this[intervalName]) {
            clearInterval(this[intervalName]);
        }

        // Apply sink ID every 2 seconds for the next 10 seconds to catch newly created elements
        let attempts = 0;
        const maxAttempts = 5;

        this[intervalName] = setInterval(async () => {
            attempts++;
            await this.applySpeakerToParticipantType(participantTypes, speakerId);

            if (attempts >= maxAttempts) {
                clearInterval(this[intervalName]);
                this[intervalName] = null;
            }
        }, 2000);
    }

    /**
     * Schedule periodic re-application of sink ID to handle race conditions
     */
    schedulePeriodicSinkIdApplication() {
        // Clear any existing interval
        if (this.sinkIdInterval) {
            clearInterval(this.sinkIdInterval);
        }

        // Apply sink ID every 2 seconds for the next 10 seconds to catch newly created elements
        let attempts = 0;
        const maxAttempts = 5;

        this.sinkIdInterval = setInterval(async () => {
            attempts++;
            await this.applySinkIdToAllMedia();

            if (attempts >= maxAttempts) {
                clearInterval(this.sinkIdInterval);
                this.sinkIdInterval = null;
            }
        }, 2000);
    }

    /**
     * Apply sink ID to newly created elements (call this from React components)
     */
    async handleNewMediaElement(element) {
        if (!element) return;

        // Wait a bit to ensure the element is fully initialized
        setTimeout(async () => {
            await this.applySinkIdToElement(element);
        }, 100);
    }

    /**
     * Helper method to get audio elements from shadow DOM or document body
     */
    getAudioElement(elementId) {
        // Try shadow DOM first
        if (this.audioShadowRoot) {
            const element = this.audioShadowRoot.getElementById(elementId);
            if (element) return element;
        }

        // Fallback to document body
        return document.getElementById(elementId);
    }

    /**
     * Apply speaker to a specific element without affecting global settings
     */
    async applySpeakerToElement(element, speakerId) {
        if (!element || !speakerId || speakerId === 'default') return;

        try {
            if (typeof element.setSinkId === 'function') {
                // Check if sink ID is already set to avoid unnecessary calls
                if (element.sinkId === speakerId) {
                    return;
                }

                // Apply setSinkId with retry logic for AbortError
                await this.setSinkIdWithRetry(element, speakerId);
                console.log(`✅ Applied speaker ${speakerId} to element ${element.id}`);
            } else {
                console.warn('setSinkId not supported for element:', element);
            }
        } catch (error) {
            console.warn(`Failed to set sinkId to ${speakerId} for element:`, error);
        }
    }

    /**
     * Set local speaker (affects only local and bot-local audio elements)
     */
    async setLocalSpeaker(speakerId) {
        try {
            // Update local speaker selection
            this.#speakers.forEach(speaker => speaker.isSelected = speaker.id === speakerId);
            const selectedSpeaker = this.#speakers.find(speaker => speaker.id === speakerId);

            if (!selectedSpeaker) {
                console.warn('Selected local speaker not found:', speakerId);
                return;
            }

            // Store the selected speaker ID for local participant
            this.#selectedSpeakerId = speakerId;

            // Apply speaker change only to local participant audio elements
            await this.applySpeakerToParticipantType(['local', 'bot-local'], speakerId);

            // Try Daily.co API for local participant
            if (this.#translatorClient && this.#translatorClient.CallObject) {
                try {
                    await this.#translatorClient.CallObject.setOutputDeviceAsync({
                        outputDeviceId: speakerId
                    });
                } catch (dailyError) {
                    console.warn('Daily.co API failed for local speaker:', dailyError);
                }
            }

            // Schedule periodic re-application for local participant elements only
            this.schedulePeriodicSinkIdApplicationForParticipantTypes(['local', 'bot-local'], speakerId);

            // Debug audio elements after change
            // setTimeout(() => this.debugAudioElements(), 500);
        } catch (error) {
            console.error('Failed to set local speaker:', error);
            throw error;
        }
    }

    /**
     * Set remote speaker (affects only iframe participant's local audio elements)
     */
    async setRemoteSpeaker(speakerId) {
        try {
            // Update remote speaker selection state
            this.#speakersRemote.forEach(speaker => speaker.isSelected = speaker.id === speakerId);
            const selectedSpeaker = this.#speakersRemote.find(speaker => speaker.id === speakerId);

            if (!selectedSpeaker) {
                console.warn('Selected remote speaker not found:', speakerId);
                return;
            }

            // For remote participants, we DON'T change audio elements in the main window
            // Instead, we only send the speaker change message to the iframe participant
            // The iframe participant will change its own local audio elements
            this.sendSpeakerChangeToRemote(speakerId);

            // Debug audio elements after change (should show no changes in main window)
            // setTimeout(() => {
            //     this.debugAudioElements();
            // }, 500);
        } catch (error) {
            console.error('Failed to set remote speaker:', error);
            throw error;
        }
    }

    /**
     * Apply speaker change to specific participant types only
     */
    async applySpeakerToParticipantType(participantTypes, speakerId) {
        if (!speakerId || speakerId === 'default') return;

        try {
            const videoElements = document.querySelectorAll('video');
            const audioElements = document.querySelectorAll('audio');
            const allElements = [...videoElements, ...audioElements].filter(element => !element.id.includes('ivr'));

            // Debug: Show all elements before filtering
            allElements.forEach((element, index) => {
                const participantType = element.getAttribute('data-participant-type');
                const participantId = element.getAttribute('data-participant-id');
                const tagName = element.tagName.toLowerCase();
            });

            // Filter elements by participant type
            const filteredElements = allElements.filter(element => {
                const participantType = element.getAttribute('data-participant-type');
                return participantType && participantTypes.includes(participantType);
            });


            // Debug: Show which elements are being affected
            filteredElements.forEach((element, index) => {
                const participantType = element.getAttribute('data-participant-type');
                const participantId = element.getAttribute('data-participant-id');
                const tagName = element.tagName.toLowerCase();
            });

            // Apply speaker change to filtered elements
            const promises = filteredElements.map(element => this.applySinkIdToElement(element, speakerId));
            await Promise.all(promises);

        } catch (error) {
            console.error('Failed to apply speaker to participant types:', error);
        }
    }

    /**
     * Debug method to check audio element attributes
     */

    muteRemoteParticipant(shouldMute) {
        try {
            const participants = this.getValue('participants') || [];
            const remoteParticipant = participants.find(p => !p.local && !p.user_name.startsWith('bot-'));

            if (!remoteParticipant) {
                console.warn('No remote participant found to mute/unmute');
                return false;
            }

            // Store mute state
            this.setValue('isRemoteMuted', shouldMute);

            // Mute/unmute all audio/video elements for remote participant
            this.applyRemoteMuteState(remoteParticipant.session_id, shouldMute);

            // If using Daily.co, we can also use their API
            if (this.#translatorClient && this.#translatorClient.CallObject) {
                try {
                    // Update subscription to audio track
                    this.#translatorClient.CallObject.updateParticipant(remoteParticipant.session_id, {
                        setSubscribedTracks: {
                            audio: !shouldMute,
                            video: true // Keep video subscription unchanged
                        }
                    });
                } catch (dailyError) {
                    console.warn('Daily.co participant update failed:', dailyError);
                }
            }

            // Notify UI of the change
            this.notify('RemoteMuteState');

            return true;
        } catch (error) {
            console.error('Error muting/unmuting remote participant:', error);
            toast.error(`Failed to ${shouldMute ? 'mute' : 'unmute'} remote participant`, {
                style: TOAST_STYLE.ERROR
            });
            return false;
        }
    }

    // Apply mute state to all audio elements for a specific participant
    applyRemoteMuteState(participantId, shouldMute) {
        // Find all audio and video elements
        const mediaElements = document.querySelectorAll('audio, video').filter(element => !element.id.includes('ivr'));

        mediaElements.forEach(element => {
            const elementParticipantId = element.getAttribute('data-participant-id');
            const elementParticipantType = element.getAttribute('data-participant-type');

            // Check if this element belongs to the remote participant or bot-remote
            if (elementParticipantId === participantId ||
                elementParticipantType === 'remote' ||
                elementParticipantType === 'bot-remote') {

                // Apply mute state
                element.muted = shouldMute;

                // For audio elements, we might also want to pause/play
                if (shouldMute && element.tagName === 'AUDIO') {
                    element.volume = 0;
                } else if (!shouldMute && element.tagName === 'AUDIO') {
                    element.volume = 1;
                }
            }
        });
    }

    // Get current remote mute state
    getRemoteMuteState() {
        return this.getValue('isRemoteMuted') || false;
    }

    // Handle participant updates to maintain mute state
    handleParticipantUpdate() {
        // Check if remote is muted and reapply if needed
        const isRemoteMuted = this.getValue('isRemoteMuted');
        if (isRemoteMuted) {
            const participants = this.getValue('participants') || [];
            const remoteParticipant = participants.find(p => !p.local && !p.user_name.startsWith('bot-'));

            if (remoteParticipant) {
                // Reapply mute state after a short delay to ensure elements are rendered
                setTimeout(() => {
                    this.applyRemoteMuteState(remoteParticipant.session_id, true);
                }, 100);
            }
        }
    }

    setRemoteParticipantVolume(participantId, volume) {
        const dailyManager = getDailyManager();
        dailyManager.setParticipantVolume(participantId, volume);

        // Also send to iframe participants if needed
        const message = {
            source: 'realtime-translate',
            type: 'REMOTE_VOLUME_CHANGE',
            data: {
                participantId: participantId,
                volume: volume
            },
            timestamp: Date.now()
        };

        this.sendMessageToIframeParticipants(message);
    }

    async muteRemoteParticipantIframe(participantId, shouldMute) {
        try {
            const message = {
                source: 'realtime-translate',
                type: 'REMOTE_MUTE_CHANGE',
                data: {
                    participantId: participantId,
                    muted: shouldMute
                },
                timestamp: Date.now()
            };

            this.sendMessageToIframeParticipants(message);
        } catch (error) {
            console.error('Failed to mute/unmute remote participant:', error);
            toast.error('Failed to change mute state', {
                style: TOAST_STYLE.ERROR
            });
        }
    }

    sendMessageToIframeParticipants(message) {
        if (this.#additionalParticipants.size === 0) {
            console.warn('No additional participants to send message to');
            return;
        }

        const targetOrigin = this.getPostMessageTargetOrigin();

        for (const [participantId, participantData] of this.#additionalParticipants) {
            if (participantData.type === 'iframe' && participantData.iframe) {
                try {
                    participantData.iframe.contentWindow.postMessage(message, targetOrigin);
                } catch (error) {
                    console.error(`Failed to send message to iframe participant ${participantId}:`, error);
                }
            }
        }
    }

    async applyVolumeChange(volume, participantId) {
        try {
            if (this.getValue('isJoined') && this.#translatorClient) {
                // Get all audio/video elements
                const audioElements = document.querySelectorAll('audio, video').filter(element => !element.id.includes('ivr'));

                // Filter elements with STRICT participant matching
                const targetElements = Array.from(audioElements).filter(element => {
                    const elementParticipantId = element.getAttribute('data-participant-id');
                    const elementParticipantType = element.getAttribute('data-participant-type');

                    // If participantId is provided, ONLY target that specific participant
                    if (participantId) {
                        return elementParticipantId === participantId;
                    }

                    // If no specific participantId, target remote participants only
                    // BUT only if they have proper attributes (no fallback matching)
                    return elementParticipantType === 'remote' ||
                        elementParticipantType === 'bot-remote';
                });

                // Only proceed if we found matching elements
                if (targetElements.length === 0) {
                    console.warn(`⚠️ No audio elements found for participant ${participantId || 'remote participants'}`);
                    return;
                }

                // Apply volume only to filtered elements
                targetElements.forEach(element => {
                    if (element.volume !== undefined) {
                        element.volume = volume;
                    }
                });

                // Also try Daily.co API if available for more precise control
                if (this.#translatorClient.CallObject) {
                    try {
                        const participants = this.#translatorClient.CallObject.participants();

                        if (participantId) {
                            // Only target specific participant if they exist in the call
                            if (participants[participantId]) {
                                this.#translatorClient.CallObject.updateReceiveSettings({
                                    [participantId]: {
                                        audio: {
                                            volume: volume
                                        }
                                    }
                                });
                            } else {
                                console.warn(`⚠️ Participant ${participantId} not found in Daily.co participants`);
                            }
                        } else {
                            // Target all remote participants
                            let remoteCount = 0;
                            for (const [sessionId, participant] of Object.entries(participants)) {
                                if (!participant.local) {
                                    this.#translatorClient.CallObject.updateReceiveSettings({
                                        [sessionId]: {
                                            audio: {
                                                volume: volume
                                            }
                                        }
                                    });
                                    remoteCount++;
                                }
                            }
                        }
                    } catch (dailyError) {
                        console.warn('Daily.co volume update failed:', dailyError);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to apply volume change in iframe participant:', error);
        }
    }

    // Fixed applyMuteChange method with strict participant matching
    async applyMuteChange(shouldMute, participantId) {
        try {
            if (this.getValue('isJoined') && this.#translatorClient) {
                // Get all audio/video elements
                const audioElements = document.querySelectorAll('audio, video').filter(element => !element.id.includes('ivr'));

                // Filter elements with STRICT participant matching
                const targetElements = Array.from(audioElements).filter(element => {
                    const elementParticipantId = element.getAttribute('data-participant-id');
                    const elementParticipantType = element.getAttribute('data-participant-type');

                    // If participantId is provided, ONLY target that specific participant
                    if (participantId) {
                        return elementParticipantId === participantId;
                    }

                    // If no specific participantId, target remote participants only
                    // BUT only if they have proper attributes (no fallback matching)
                    return elementParticipantType === 'remote' ||
                        elementParticipantType === 'bot-remote';
                });

                // Only proceed if we found matching elements
                if (targetElements.length === 0) {
                    console.warn(`⚠️ No audio elements found for participant ${participantId || 'remote participants'}`);
                    return;
                }

                // Apply mute only to filtered elements
                targetElements.forEach(element => {
                    element.muted = shouldMute;
                });

                // Also try Daily.co API if available
                if (this.#translatorClient.CallObject) {
                    try {
                        const participants = this.#translatorClient.CallObject.participants();

                        if (participantId) {
                            // Only target specific participant if they exist in the call
                            if (participants[participantId]) {
                                this.#translatorClient.CallObject.updateReceiveSettings({
                                    [participantId]: {
                                        audio: {
                                            blocked: shouldMute
                                        }
                                    }
                                });
                            } else {
                                console.warn(`⚠️ Participant ${participantId} not found in Daily.co participants`);
                            }
                        } else {
                            // Target all remote participants
                            let remoteCount = 0;
                            for (const [sessionId, participant] of Object.entries(participants)) {
                                if (!participant.local) {
                                    this.#translatorClient.CallObject.updateReceiveSettings({
                                        [sessionId]: {
                                            audio: {
                                                blocked: shouldMute
                                            }
                                        }
                                    });
                                    remoteCount++;
                                }
                            }
                        }
                    } catch (dailyError) {
                        console.warn('Daily.co mute update failed:', dailyError);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to apply mute change in iframe participant:', error);
        }
    }
    // 9. Utility method to get all iframe participants
    getIframeParticipants() {
        const participants = [];
        for (const [participantId, participantData] of this.#additionalParticipants) {
            if (participantData.type === 'iframe') {
                participants.push({
                    id: participantId,
                    name: participantData.participantName,
                    iframe: participantData.iframe
                });
            }
        }
        return participants;
    }
}

export default new IndexWatcher();