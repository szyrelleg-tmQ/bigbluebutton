import React, { useState, useEffect } from 'react';
import Button from '/imports/ui/components/common/button/component';
import ModalSimple from '/imports/ui/components/common/modal/simple/component';
import DeviceSelector from '/imports/ui/components/audio/device-selector/component';
import { getTranslatorClient } from 'translator-client';
import { defineMessages, useIntl } from 'react-intl';
import AudioManager from '/imports/ui/services/audio-manager';
import LanguageIcon from '/public/svgs/language.svg';

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
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            setLoading(true);
            const fetchData = async () => {
                try {
                    const translatorClient = getTranslatorClient({ baseUrl: "https://pipecat-translate.ph03.us" });
                    const fetchedVoices = await translatorClient.fetchVoices();
                    const fetchedLanguages = await translatorClient.fetchLanguages();
                    setVoices(fetchedVoices);
                    setLanguages(fetchedLanguages);

                    // Get last used voice/language
                    const lastVoice = AudioManager.lastJoinOptions?.voice;
                    const lastLanguage = AudioManager.lastJoinOptions?.language;

                    // Use last used if available, else default to first
                    setSelectedVoice(
                        fetchedVoices.find(v => v.key === lastVoice) ? lastVoice : (fetchedVoices[0]?.key || '')
                    );
                    setSelectedLanguage(
                        fetchedLanguages.find(l => l.key === lastLanguage) ? lastLanguage : (fetchedLanguages[0]?.key || fetchedLanguages[0] || '')
                    );
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
            const translatorClient = AudioManager._translatorCallObject;
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
            };
        } catch (err) {
            // Optionally, handle error
            // notify('Failed to update voice/language', true);
        }
        setOpen(false);
    };

    const handleCancel = () => setOpen(false);

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