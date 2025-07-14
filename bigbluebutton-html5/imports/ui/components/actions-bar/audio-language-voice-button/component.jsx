import React, { useState, useEffect } from 'react';
import Button from '/imports/ui/components/common/button/component';
import Modal from '/imports/ui/components/common/modal/component';
import DeviceSelector from '/imports/ui/components/audio/device-selector/component';
import { getTranslatorClient } from 'translator-client';
import { defineMessages, useIntl } from 'react-intl';

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
                    setSelectedVoice(fetchedVoices[0]?.key || '');
                    setSelectedLanguage(fetchedLanguages[0]?.key || fetchedLanguages[0] || '');
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
        // TODO: Call service to change voice/language live
        setOpen(false);
    };

    const handleCancel = () => setOpen(false);

    return (
        <>
            <Button
                icon="language"
                label={intl.formatMessage(intlMessages.buttonLabel)}
                hideLabel
                circle
                size="lg"
                color="default"
                onClick={() => setOpen(true)}
            />
            {open && (
                <Modal
                    isOpen={open}
                    onRequestClose={handleCancel}
                    contentLabel={intl.formatMessage(intlMessages.buttonLabel)}
                >
                    <h3>{intl.formatMessage(intlMessages.buttonLabel)}</h3>
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
                </Modal>
            )}
        </>
    );
};

export default AudioLanguageVoiceButton; 