import React, { useState, useEffect } from 'react';
import Button from '/imports/ui/components/common/button/component';
import ModalSimple from '/imports/ui/components/common/modal/simple/component';
import DeviceSelector from '/imports/ui/components/audio/device-selector/component';
import { getTranslatorClient } from 'translator-client';
import { defineMessages, useIntl } from 'react-intl';
import AudioManager from '/imports/ui/services/audio-manager';
import LanguageIcon from '/public/svgs/language.svg';
import { selectedTranslationLanguageVar } from '/imports/ui/services/audio-manager';
import { getDailyManager } from '/imports/ui/services/audio-manager/watcher/DailyManager';
const intlMessages = defineMessages({
    buttonLabel: {
        id: 'app.audio.languageVoiceButton.label',
        defaultMessage: 'Audio Language/Voice',
    },
    voiceLabel: {
        id: 'app.audio.languageVoiceButton.voice',
        defaultMessage: 'Voice',
    },
    languageLabel: {
        id: 'app.audio.languageVoiceButton.language',
        defaultMessage: 'Language',
    },
    botToggleLabel: {
        id: 'app.audio.languageVoiceButton.botToggle',
        defaultMessage: 'Enable Voice Translation',
    },
    volumeLabel: {
        id: 'app.audio.languageVoiceButton.volume',
        defaultMessage: 'Volume',
    },
    confirm: {
        id: 'app.audio.languageVoiceButton.confirm',
        defaultMessage: 'Confirm',
    },
    cancel: {
        id: 'app.audio.languageVoiceButton.cancel',
        defaultMessage: 'Cancel',
    },
});

const AudioLanguageVoiceButton = () => {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    const [voices, setVoices] = useState([]);
    const [languages, setLanguages] = useState([]);
    const [selectedVoice, setSelectedVoice] = useState('');
    const [selectedLanguage, setSelectedLanguage] = useState('');
    const [botEnabled, setBotEnabled] = useState(true);
    const [volume, setVolume] = useState(50);
    const [originalVolume, setOriginalVolume] = useState(50);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            setLoading(true);
            const fetchData = async () => {
                try {
                    const fetchedVoices = await AudioManager.TranslatorCallObject.fetchVoices();
                    const fetchedLanguages = await AudioManager.TranslatorCallObject.fetchLanguages();
                    setVoices(fetchedVoices);
                    setLanguages(fetchedLanguages);

                    // Get last used voice/language/volume settings
                    const lastVoice = AudioManager.lastJoinOptions?.voice;
                    const lastLanguage = AudioManager.lastJoinOptions?.language;
                    const lastVolume = AudioManager.lastJoinOptions?.volume ?? 50;

                    // Use last used if available, else default to first
                    setSelectedVoice(
                        fetchedVoices.find(v => v.key === lastVoice) ? lastVoice : (fetchedVoices[0]?.key || '')
                    );
                    setSelectedLanguage(
                        fetchedLanguages.find(l => l.key === lastLanguage) ? lastLanguage : (fetchedLanguages[0]?.key || fetchedLanguages[0] || '')
                    );
                    setVolume(lastVolume);
                    setOriginalVolume(lastVolume);
                } catch (err) {
                    setVoices([]);
                    setLanguages([]);
                } finally {
                    setLoading(false);
                }
            };
            fetchData();
        }
    }, [open]);

    const handleConfirm = () => {
        // Try to update the current translator client if available
        try {
            // AudioManager._translatorCallObject is the current translator client instance
            const translatorClient = getDailyManager()
            if (translatorClient) {
                if (typeof translatorClient.setVoice === 'function') {
                    translatorClient.setVoice(selectedVoice, selectedLanguage);
                }
                if (typeof translatorClient.setLanguage === 'function') {
                    translatorClient.setLanguage(selectedLanguage);
                }
            }

            // Update AudioManager.lastJoinOptions so the new values are reflected next time
            AudioManager.lastJoinOptions = {
                ...(AudioManager.lastJoinOptions || {}),
                voice: selectedVoice,
                language: selectedLanguage,
                volume: volume,
            };

            // Set the selected translation language for reactivity
            selectedTranslationLanguageVar(selectedLanguage);
        } catch (err) {
            // Optionally, handle error
            // notify('Failed to update voice/language/volume settings', true);
        }
        setOpen(false);
    };

    const handleCancel = () => {
        // Revert volume to original value
        setVolume(originalVolume);

        // Revert volume in the translator client if available
        try {
            const translatorClient = AudioManager._translatorCallObject;
            if (translatorClient && typeof translatorClient.setVolume === 'function') {
                translatorClient.setVolume(originalVolume / 100);
            }
        } catch (err) {
            console.warn('Failed to revert volume settings:', err);
        }

        setOpen(false);
    };

    const handleBotToggle = (enabled) => {
        setBotEnabled(enabled);
        try {
            AudioManager.toggleTranslation(enabled);
        } catch (err) {
            // Optionally handle error
            console.warn('Failed to update bot settings:', err);
        }
    };

    const handleVolumeChange = (newVolume) => {
        setVolume(newVolume);

        // Apply volume change immediately for preview, but don't save to AudioManager
        try {
            AudioManager.setParticipantVolume(newVolume / 100); // Convert to 0-1 range
        } catch (err) {
            console.warn('Failed to update volume settings:', err);
        }
    };

    return (
        <>
            <Button
                customIcon={<img src={LanguageIcon} alt="Language/Voice" style={{ width: 24, height: 24 }} />}
                label={intl.formatMessage(intlMessages.buttonLabel)}
                hideLabel
                circle
                size="lg"
                color="default"
                onClick={() => setOpen(true)}
            />
            {open && (
                <ModalSimple
                    modalIsOpen={open}
                    onRequestClose={handleCancel}
                    title={intl.formatMessage(intlMessages.buttonLabel)}
                >
                    {loading ? (
                        <div>Loading...</div>
                    ) : (
                        <>
                            <div>
                                <label>{intl.formatMessage(intlMessages.voiceLabel)}</label>
                                <DeviceSelector
                                    kind="voice"
                                    deviceId={selectedVoice}
                                    devices={voices.map((v) => ({ deviceId: v.key || v, label: v.name || v.key || v }))}
                                    onChange={setSelectedVoice}
                                    blocked={false}
                                    intl={intl}
                                    supportsTransparentListenOnly={false}
                                />
                            </div>
                            <div>
                                <label>{intl.formatMessage(intlMessages.languageLabel)}</label>
                                <DeviceSelector
                                    kind="language"
                                    deviceId={selectedLanguage}
                                    devices={languages.map((l) => ({ deviceId: l.key || l, label: l.name || l.key || l }))}
                                    onChange={setSelectedLanguage}
                                    blocked={false}
                                    intl={intl}
                                    supportsTransparentListenOnly={false}
                                />
                            </div>
                            <div style={{ marginTop: 16, marginBottom: 16 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={botEnabled}
                                        onChange={(e) => handleBotToggle(e.target.checked)}
                                        style={{ cursor: 'pointer' }}
                                    />
                                    {intl.formatMessage(intlMessages.botToggleLabel)}
                                </label>
                            </div>
                            {/* <div style={{ marginTop: 16, marginBottom: 16 }}>
                                <label style={{ display: 'block', marginBottom: 8 }}>
                                    {intl.formatMessage(intlMessages.volumeLabel)}: {volume}%
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: '14px', color: '#666' }}>0%</span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="1"
                                        value={volume}
                                        onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                                        style={{
                                            flex: 1,
                                            cursor: 'pointer',
                                            height: '4px',
                                            background: '#ddd',
                                            borderRadius: '2px',
                                            outline: 'none',
                                            WebkitAppearance: 'none',
                                        }}
                                    />
                                    <span style={{ fontSize: '14px', color: '#666' }}>100%</span>
                                </div>
                            </div> */}
                            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                <Button
                                    label={intl.formatMessage(intlMessages.cancel)}
                                    color="secondary"
                                    onClick={handleCancel}
                                    size="md"
                                />
                                <Button
                                    label={intl.formatMessage(intlMessages.confirm)}
                                    color="primary"
                                    onClick={handleConfirm}
                                    size="md"
                                />
                            </div>
                        </>
                    )}
                </ModalSimple>
            )}
        </>
    );
};

export default AudioLanguageVoiceButton;