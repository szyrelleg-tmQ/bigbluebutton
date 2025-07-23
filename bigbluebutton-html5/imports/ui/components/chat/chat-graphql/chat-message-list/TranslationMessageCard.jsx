// TranslationMessageCard.js
import React, { useState } from 'react';
import styled from 'styled-components';

// --- Styled Components ---

const MessageCard = styled.div`
  display: flex;
  align-items: flex-start; /* Align avatar to the top of the content */
  gap: 16px;
  max-width: 600px;
  width: 100%;
  padding: 16px;
  transition: background-color 0.2s ease-in-out;

  &:hover {
    background-color: #f9f9f9;
    border-radius: 12px;
  }
`;

const AvatarContainer = styled.div`
  width: 42px;
  height: 42px;
  min-width: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 500;
  color: #fff;
  background-color: ${props => props.color || '#888'};
`;

const ContentContainer = styled.div`
  flex: 1;
  min-width: 0;
`;

const Header = styled.div`
  font-weight: 600;
  font-size: 16px;
  color: #111;
  margin-bottom: 8px;
`;

const TranslatedText = styled.p`
  font-size: 16px;
  color: #333;
  line-height: 1.5;
  word-wrap: break-word;
  margin: 0 0 12px 0;
`;

const OriginalTextContainer = styled.div`
  background-color: #f0f2f5;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  color: #555;
  line-height: 1.4;
  word-wrap: break-word;
`;

const ActionsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
`;

const ActionButton = styled.button`
  background: none;
  border: none;
  color: #555;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 0;
  font-weight: 500;

  &:hover {
    color: #000;
  }
`;

// --- Helper Functions ---

const getAvatarInfo = (participantName) => {
    const nameSlug = typeof participantName === 'string' ? participantName.match(/^([a-z-]+)/) : null;
    const originalName = nameSlug ? nameSlug[1].replace(/-/g, ' ') : 'User';
    // Note: getConsistentAvatarColor should be defined in a shared utility file
    const avatarColor = getConsistentAvatarColor(undefined, originalName);
    const avatarText = originalName.slice(0, 1).toUpperCase();
    return { originalName, avatarColor, avatarText };
};


// --- The Component ---

export const TranslationMessageCard = ({ message, userLang }) => {
    const [showOriginal, setShowOriginal] = useState(false);
    const { originalName, avatarColor, avatarText } = getAvatarInfo(message.participant_name);

    const translatedText = message.translations[userLang] || message.original;

    const handleCopy = () => {
        navigator.clipboard.writeText(translatedText).then(() => {
            // Optional: Show a "Copied!" toast/notification
            alert('Translated text copied to clipboard!');
        });
    };

    return (
        <MessageCard>
            <AvatarContainer color={avatarColor}>{avatarText}</AvatarContainer>
            <ContentContainer>
                <Header>{originalName}</Header>
                <TranslatedText>{translatedText}</TranslatedText>

                {showOriginal && (
                    <OriginalTextContainer>
                        <strong>Original:</strong> {message.original}
                    </OriginalTextContainer>
                )}

                <ActionsRow>
                    <ActionButton onClick={() => setShowOriginal(!showOriginal)}>
                        {showOriginal ? 'Hide original' : 'Show original'}
                    </ActionButton>
                    <ActionButton onClick={handleCopy}>
                        Copy translation
                    </ActionButton>
                </ActionsRow>
            </ContentContainer>
        </MessageCard>
    );
};