class AudioRoutingService {
    constructor() {
        this.currentLocalUserName = null;
    }

    // Helper function to check if participant is a bot
    isBot(userName) {
        return userName && userName.startsWith('bot-');
    }

    // Helper function to check if bot belongs to a specific user
    isBotForUser(botUserName, userName) {
        if (!this.isBot(botUserName) || !userName) return false;

        // Bot name format: bot-{username}-{uuid}
        const botNameWithoutPrefix = botUserName.replace('bot-', '');

        // Check if bot name starts with the username
        return botNameWithoutPrefix.startsWith(userName);
    }

    // Filter participants for current user
    filterParticipants(allParticipants, currentUserName) {
        if (!allParticipants || !Array.isArray(allParticipants)) {
            console.warn('Invalid participants array provided to filterParticipants');
            return {
                local: null,
                remote: null,
                botLocal: null,
                botRemote: null,
                all: []
            };
        }

        this.currentLocalUserName = currentUserName;

        const filtered = {
            local: null,
            remote: null,
            botLocal: null,
            botRemote: null,
            all: allParticipants
        };

        // Find local participant (current user)
        filtered.local = allParticipants.find(p => p.local === true);

        // If we found a local participant, use their username as the current user
        if (filtered.local && !currentUserName) {
            currentUserName = filtered.local.user_name;
            this.currentLocalUserName = currentUserName;
        }

        // Find remote participant (other human user, not bot)
        filtered.remote = allParticipants.find(p =>
            !p.local &&
            !this.isBot(p.user_name)
        );

        // Find bot-local (bot belonging to current user)
        if (currentUserName) {
            filtered.botLocal = allParticipants.find(p => {
                if (!this.isBot(p.user_name)) return false;

                const isBotForCurrentUser = this.isBotForUser(p.user_name, currentUserName);
                if (isBotForCurrentUser) {
                }
                return isBotForCurrentUser;
            });
        }

        // Find bot-remote (bot belonging to other user)
        filtered.botRemote = allParticipants.find(p => {
            if (!this.isBot(p.user_name)) return false;

            // If we already identified this as bot-local, skip it
            if (filtered.botLocal && p.session_id === filtered.botLocal.session_id) {
                return false;
            }

            // This is a bot that doesn't belong to the current user
            const isBotForOtherUser = !this.isBotForUser(p.user_name, currentUserName);
            if (isBotForOtherUser) {
            }
            return isBotForOtherUser;
        });

        return filtered;
    }

    // Get current audio state for debugging
    getAudioState() {
        return {
            currentLocalUserName: this.currentLocalUserName
        };
    }
}

// Export singleton instance
let audioRoutingServiceInstance = null;

/**
 * 
 * @returns {AudioRoutingService}
 */
export function getAudioRoutingService() {
    if (!audioRoutingServiceInstance) {
        audioRoutingServiceInstance = new AudioRoutingService();
    }
    return audioRoutingServiceInstance;
}

export function resetAudioRoutingService() {
    audioRoutingServiceInstance = null;
}

export default AudioRoutingService;