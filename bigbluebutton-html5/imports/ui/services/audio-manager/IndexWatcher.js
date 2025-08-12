// --- START OF REFACTORED FILE IndexWatcher.js ---

import DailyManager from "./DailyManager";
// We no longer import Watcher
import { getTranslatorClient, DeviceDetection } from "translator-client";
import EventManager from "./Events.js";

// IndexWatcher now extends EventTarget to become a standard event emitter.
class IndexWatcher extends EventTarget {
    #dailyManager = null;
    #translatorClient = null;
    #voices = null;
    #languages = null;
    #remoteLanguages = null;
    #clientSettings = null;
    #baseUrl = null;
    constructor() {
        super(); // Important: call super() for EventTarget
        this.initDailyManager();
        // Fire off initial data fetching
        this.getClientSettings();
        this.getLanguages();
        this.getVoices();
        this.#baseUrl = window.meetingClientSettings.public.pipecat.baseUrl || 'https://pipecat.app';
    }

    // Helper to dispatch events
    #dispatchEvent(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    #setState(key, value) {
        this.state[key] = value;
        // Dispatch an event with the key that changed and the new state
        this.#dispatchEvent('state-change', { key, value });
        this.#dispatchEvent(`state-change:${key}`, { value });
    }

    getValue(key) {
        return this.state[key];
    }

    initDailyManager() {
        if (this.#dailyManager) return;
        console.log(`%c[DEBUGGER] IndexWatcher.initDailyManager() is creating a new DailyManager.`, 'color: orange; font-weight: bold;');
        console.trace(); // Shows the call stack that triggered this.
        debugger;
        this.#dailyManager = new DailyManager();
    }


    async getClientSettings() {
        if (this.#clientSettings) return this.#clientSettings;
        try {
            const res = await fetch(`${this.#baseUrl}/api/settings`);
            if (!res.ok) {
                console.error('Failed to fetch client settings:', res.statusText);
                return;
            }
            const clientSettings = await res.json();
            this.#clientSettings = clientSettings.settings?.client_settings || clientSettings;
            EventManager.setDefaultConfig({
                localRawVolume: this.#clientSettings?.human_volume || 1,
                localTranslatedVolume: this.#clientSettings?.local_bot_volume || 0.5,
                remoteRawVolume: this.#clientSettings?.human_volume || 1,
                remoteTranslatedVolume: this.#clientSettings?.bot_volume || 0.2,
                debouncerDelay: this.#clientSettings?.debouncer || 100,
                silenceDuration: this.#clientSettings?.silence_duration || 1000,
            });
            return this.#clientSettings;
        } catch (error) {
            console.error('Failed to fetch client settings:', error);
        }
    }

    async getVoices() {
        if (this.#voices && this.#voices.length > 0) return this.#voices;
        const voices = await this.fetchVoices();
        if (voices.length === 0) {
            console.warn('No voices found from translator client');
            return [];
        }

        this.#voices = voices.map(voice => ({
            id: voice.key,
            name: voice.name + ` (${voice.gender})`,
            isSelected: voice.key === 'aria'
        }));
        return this.#voices;
    }

    async getLanguages() {
        if (this.#languages && this.#languages.length > 0) return { languages: this.#languages, remoteLanguages: this.#remoteLanguages };
        const languages = await this.fetchLanguages();

        this.#languages = languages.map(lang => ({ ...lang, isSelected: lang.key === 'english' }));
        this.#remoteLanguages = languages.map(lang => ({ ...lang, isSelected: lang.key === 'english' }));
        return { languages: this.#languages, remoteLanguages: this.#remoteLanguages };
    }

    // e.g. joinRoom
    async joinRoom(userName, language, roomUrl, voice, voiceEnabled = true) {

        this.initDailyManager();
        try {
            if (roomUrl.includes('http')) roomUrl = roomUrl.split('/').pop();
            const data = await this.startBot(roomUrl, userName, language, voice, true);
            const success = await this.DailyManager.joinRoom(data.room_url, data.userName);
            return success;
        } catch (error) {
            console.error('IndexWatcher: Error joining room:', error);
            this.#setState(LOADER.JOIN_ROOM, false); // ensure loader is turned off on error
            return false;
        }
    }

    async startBot(roomName, userName = 'Anonymous', language = 'Spanish', voice = 'aria', is_video_off = false) {
        // Use browser-safe UUID
        const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        const res = await fetch(`${this.baseUrl}/room`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room_name: roomName,
                is_video_off,
                language: language,
                userName: `${userName}-${sessionId}`,
                voice: voice
            }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return data;
    }


    async fetchVoices() {
        try {
            const response = await fetch(`${this.#baseUrl}/api/voices`);

            if (!response.ok) {
                throw new Error(`Failed to fetch voices: ${response.status}`);
            }

            const data = await response.json();

            // Add icons to voice data
            const voicesWithIcons = data.voices.map((voice) => ({
                ...voice,
            }));

            return voicesWithIcons;
        } catch (err) {
            console.error('Error fetching voices:', err);

            // Fallback to default voices if API fails
            const fallbackVoices = [
                {
                    key: 'aria',
                    name: 'Aria',
                    description: 'Clear and professional',
                },
                {
                    key: 'nova',
                    name: 'Nova',
                    description: 'Warm and friendly',
                },
                {
                    key: 'sage',
                    name: 'Sage',
                    description: 'Calm and soothing',
                }
            ];

            return fallbackVoices;
        }
    }

    // Fetch available languages
    async fetchLanguages() {
        const response = await fetch(`${this.#baseUrl}/api/languages`);
        const data = await response.json();
        return data.languages;
    }

    async leaveRoom() {
        try {
            // If the manager doesn't exist, there's nothing to do.
            if (!this.DailyManager) return true;

            const success = await this.DailyManager.leaveRoom();

            // Emit IPC event to notify main process about room leave
            if (success && window.electronAPI) {
                try {
                    await window.electronAPI.leaveRoom();
                } catch (error) {
                    console.error('🔊 Failed to send IPC room-left event:', error);
                }
            }

            // *** ADD THIS LINE ***
            // After successfully leaving, destroy the manager to remove the iframe.
            this.destroy();

            return success;
        } catch (error) {
            console.error('IndexWatcher: Error leaving room:', error);
            // Also attempt to destroy on error to clean up.
            this.destroy();
            return false;
        }
    }

    async toggleAudio() {
        const result = await this.DailyManager.toggleAudio();
        return result;
    }

    getParticipants() {
        return this.DailyManager.getParticipants();
    }

    isJoined() {
        return this.DailyManager.isJoined();
    }

    // Event handling methods
    on(eventName, handler) {
        this.DailyManager.on(eventName, handler);
    }

    off(eventName, handler) {
        this.DailyManager.off(eventName, handler);
    }

    setParticipantVolume(participantId, volume) {
        this.DailyManager.setParticipantVolume(participantId, volume);
    }

    destroy() {
        // --- DEBUGGER 5 ---
        // This confirms the watcher's cleanup process is being initiated.
        console.log(`%c[DEBUGGER] IndexWatcher.destroy() called.`, 'color: green; font-weight: bold;');
        debugger;
        if (this.#dailyManager) {
            this.#dailyManager.destroy();
            this.#dailyManager = null;
        }
    }

    // --- GETTERS (modified to be direct accessors) ---
    get DailyManager() { return this.#dailyManager; }
    get Voices() { return this.#voices; }
    get Languages() { return this.#languages; }
    get ClientSettings() { return this.#clientSettings; }

}

// Export a single instance (singleton pattern)
export default new IndexWatcher();