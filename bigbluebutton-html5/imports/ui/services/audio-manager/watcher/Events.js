import { EventEmitter } from "events";
// #NOTES: DEBUGGING
import { getDailyManager } from "./DailyManager.js";

export const EVENTS = {
    REMOTE_RAW_START: "remoteRawStart",
    REMOTE_RAW_END: "remoteRawEnd",
    REMOTE_TRANLATED_START: "remoteTranslatedStart",
    REMOTE_TRANLATED_END: "remoteTranslatedEnd",
    LOCAL_RAW_START: "localRawStart",
    LOCAL_RAW_END: "localRawEnd",
    LOCAL_TRANLATED_START: "localTranslatedStart",
    LOCAL_TRANLATED_END: "localTranslatedEnd",
};

export const STREAM_TYPES = {
    REMOTE_RAW: "remoteRaw",
    REMOTE_TRANLATED: "remoteTranslated",
    LOCAL_RAW: "localRaw",
    LOCAL_TRANLATED: "localTranslated",
};

class EventManager extends EventEmitter {
    #isIframe = false;
    #state = {
        [STREAM_TYPES.REMOTE_RAW]: false,
        [STREAM_TYPES.REMOTE_TRANLATED]: false,
        [STREAM_TYPES.LOCAL_RAW]: false,
        [STREAM_TYPES.LOCAL_TRANLATED]: false,
    };
    #volumeHanlders = {
        [STREAM_TYPES.REMOTE_RAW]: () => { },
        [STREAM_TYPES.REMOTE_TRANLATED]: () => { },
        [STREAM_TYPES.LOCAL_RAW]: () => { },
        [STREAM_TYPES.LOCAL_TRANLATED]: () => { },
    };
    #volumes = {
        [STREAM_TYPES.REMOTE_RAW]: 0,
        [STREAM_TYPES.REMOTE_TRANLATED]: 0,
        [STREAM_TYPES.LOCAL_RAW]: 0,
        [STREAM_TYPES.LOCAL_TRANLATED]: 0,
    };
    #debouncers = {
        [STREAM_TYPES.REMOTE_RAW]: null,
        [STREAM_TYPES.REMOTE_TRANLATED]: null,
        [STREAM_TYPES.LOCAL_RAW]: null,
        [STREAM_TYPES.LOCAL_TRANLATED]: null,
    };
    constructor() {
        super();
        this.startListening();
    }
    #debounce(event, handler, delay) {
        if (this.#debouncers[event]) {
            clearTimeout(this.#debouncers[event]);
        }
        this.#debouncers[event] = setTimeout(() => {
            handler();
        }, delay);
    }
    /**
     * 
     * @param {String} event 
     * @returns {Boolean}
     */
    getState(event) {
        return this.#state[event];
    }
    /**
     * 
     * @param {String} event 
     * @param {Boolean} state 
     */
    setState(event, state) {
        this.#state[event] = state;
    }
    on(event, listener) {
        const listnersCount = this.listeners(event).length;
        if (listnersCount === 0 && typeof listener === "function" && Object.values(EVENTS).includes(event));
        super.on(event, listener);
    }
    startListening() {
        this.#isIframe = window.location.search.includes('isDemo');
        this.on(EVENTS.REMOTE_RAW_START, (data) => {
            this.setState(STREAM_TYPES.REMOTE_RAW, true);
            this.cases(EVENTS.REMOTE_RAW_START, data);
        });
        this.on(EVENTS.REMOTE_RAW_END, (data) => {
            this.setState(STREAM_TYPES.REMOTE_RAW, false);
            this.cases(EVENTS.REMOTE_RAW_END, data);
        });
        this.on(EVENTS.REMOTE_TRANLATED_START, (data) => {
            this.setState(STREAM_TYPES.REMOTE_TRANLATED, true);
            this.cases(EVENTS.REMOTE_TRANLATED_START, data);
        });
        this.on(EVENTS.REMOTE_TRANLATED_END, (data) => {
            this.setState(STREAM_TYPES.REMOTE_TRANLATED, false);
            this.cases(EVENTS.REMOTE_TRANLATED_END, data);
        });
        this.on(EVENTS.LOCAL_RAW_START, (data) => {
            this.setState(STREAM_TYPES.LOCAL_RAW, true);
            this.cases(EVENTS.LOCAL_RAW_START, data);
        });
        this.on(EVENTS.LOCAL_RAW_END, (data) => {
            this.setState(STREAM_TYPES.LOCAL_RAW, false);
            this.cases(EVENTS.LOCAL_RAW_END, data);
        });
        this.on(EVENTS.LOCAL_TRANLATED_START, (data) => {
            this.setState(STREAM_TYPES.LOCAL_TRANLATED, true);
            this.cases(EVENTS.LOCAL_TRANLATED_START, data);
        });
        this.on(EVENTS.LOCAL_TRANLATED_END, (data) => {
            this.setState(STREAM_TYPES.LOCAL_TRANLATED, false);
            this.cases(EVENTS.LOCAL_TRANLATED_END, data);
        });
    }
    attachVolumeHandler(streamType, handler) {
        if (this.#volumeHanlders[streamType] && typeof handler === "function") {
            this.#volumeHanlders[streamType] = handler;
        }
    }
    cases(event) {
        const isLocalRawPlaying = this.getState(STREAM_TYPES.LOCAL_RAW);
        const isLocalTranslatedPlaying = this.getState(STREAM_TYPES.LOCAL_TRANLATED);
        const isRemoteRawPlaying = this.getState(STREAM_TYPES.REMOTE_RAW);
        const isRemoteTranslatedPlaying = this.getState(STREAM_TYPES.REMOTE_TRANLATED);
        // #NOTES: DEBUGGING
        const dailyManager = getDailyManager();
        if (dailyManager) {
            dailyManager.call.getInputSettings().then(settings => {
                console.log("dailyManager.call.getInputSettings()", settings, this.#isIframe);
            });
        }


        switch (event) {
            /**
             * CHECKS:
             * if local raw playing ? yes -> set remote raw volume 0
             * if local raw playing ? no -> if local translated playing ? yes -> set remote raw volume 0
             * if local raw playing ? no -> if local translated playing ? no -> set remote raw volume 0.1
             */
            case EVENTS.REMOTE_RAW_START:
                if (isLocalRawPlaying || isLocalTranslatedPlaying) {
                    this.#debounce(event, () => {
                        this.#volumeHanlders[STREAM_TYPES.REMOTE_RAW](0);
                        this.#volumes[STREAM_TYPES.REMOTE_RAW] = 0;
                    }, 100);
                    break;
                }

                this.#debounce(event, () => {
                    this.#volumeHanlders[STREAM_TYPES.REMOTE_RAW](0.1);
                    this.#volumes[STREAM_TYPES.REMOTE_RAW] = 0.1;
                }, 100);
                break;
            /**
             * CHECKS:
             * set remote raw volume to default: 0
             */
            case EVENTS.REMOTE_RAW_END:
                this.#debounce(event, () => {
                    this.#volumeHanlders[STREAM_TYPES.REMOTE_RAW](0);
                    this.#volumes[STREAM_TYPES.REMOTE_RAW] = 0;
                }, 100);
                break;
            /**
             * CHECKS:
             * if local raw playing ? yes -> set remote translated volume 0
             * if local raw playing ? no -> if local translated playing ? yes -> set remote translated volume 0
             * if local raw playing ? no -> if local translated playing ? no -> if remote raw playing ? yes -> set remote translated volume 0
             * if local raw playing ? no -> if local translated playing ? no -> if remote raw playing ? no -> set remote translated volume 0.2
             */
            case EVENTS.REMOTE_TRANLATED_START: {
                if (isLocalRawPlaying || isLocalTranslatedPlaying || isRemoteRawPlaying) {
                    this.#debounce(event, () => {
                        this.#volumeHanlders[STREAM_TYPES.REMOTE_TRANLATED](0);
                        this.#volumes[STREAM_TYPES.REMOTE_TRANLATED] = 0;
                    }, 100);
                    break;
                }

                this.#debounce(event, () => {
                    this.#volumeHanlders[STREAM_TYPES.REMOTE_TRANLATED](0.2);
                    this.#volumes[STREAM_TYPES.REMOTE_TRANLATED] = 0.2;
                }, 100);
                break;
            }

            /**
             * CHECKS:
             * set remote translated volume to default: 0
             */
            case EVENTS.REMOTE_TRANLATED_END:
                this.#debounce(event, () => {
                    this.#volumeHanlders[STREAM_TYPES.REMOTE_TRANLATED](0);
                    this.#volumes[STREAM_TYPES.REMOTE_TRANLATED] = 0;
                }, 100);
                break;
            /**
             * CHECKS:
             * do nothing
             */
            case EVENTS.LOCAL_RAW_START:
                this.#debounce(event, () => {
                    // this.#volumeHanlders[STREAM_TYPES.LOCAL_RAW](1);
                    // this.#volumes[STREAM_TYPES.LOCAL_RAW] = 1;

                    this.#volumeHanlders[STREAM_TYPES.REMOTE_TRANLATED](0.5);
                    this.#volumes[STREAM_TYPES.REMOTE_TRANLATED] = 0.5;
                }, 100);
                break;
            /**
             * CHECKS:
             * do nothing
             */
            case EVENTS.LOCAL_RAW_END:
                this.#debounce(event, () => {
                    // this.#volumeHanlders[STREAM_TYPES.LOCAL_RAW](1);
                    // this.#volumes[STREAM_TYPES.LOCAL_RAW] = 1;

                    // if (isRemoteTranslatedPlaying) {
                    //     this.#volumeHanlders[STREAM_TYPES.LOCAL_TRANLATED](1);
                    //     this.#volumes[STREAM_TYPES.LOCAL_TRANLATED] = 1;
                    // }
                }, 100);
                break;
            /**
             * CHECKS:
             * if local raw playing ? yes -> set local translated volume 0.5
             * if local raw playing ? no -> set local translated volume 1
             */
            case EVENTS.LOCAL_TRANLATED_START: {
                if (isLocalRawPlaying) {
                    this.#debounce(event, () => {
                        this.#volumeHanlders[STREAM_TYPES.LOCAL_TRANLATED](0.5);
                        this.#volumes[STREAM_TYPES.LOCAL_TRANLATED] = 0.5;

                        this.#volumeHanlders[STREAM_TYPES.REMOTE_TRANLATED](0);
                        this.#volumes[STREAM_TYPES.REMOTE_TRANLATED] = 0;

                        this.#volumeHanlders[STREAM_TYPES.REMOTE_RAW](0);
                        this.#volumes[STREAM_TYPES.REMOTE_RAW] = 0;
                    }, 100);
                } else {
                    this.#debounce(event, () => {
                        this.#volumeHanlders[STREAM_TYPES.LOCAL_TRANLATED](1);
                        this.#volumes[STREAM_TYPES.LOCAL_TRANLATED] = 1;

                        this.#volumeHanlders[STREAM_TYPES.REMOTE_TRANLATED](0);
                        this.#volumes[STREAM_TYPES.REMOTE_TRANLATED] = 0;

                        this.#volumeHanlders[STREAM_TYPES.REMOTE_RAW](0);
                        this.#volumes[STREAM_TYPES.REMOTE_RAW] = 0;
                    }, 100);
                }
                break;
            }

            /**
             * CHECKS:
             * set local translated volume to default: 1
             */
            case EVENTS.LOCAL_TRANLATED_END:
                this.#debounce(event, () => {
                    this.#volumeHanlders[STREAM_TYPES.LOCAL_TRANLATED](0);
                    this.#volumes[STREAM_TYPES.LOCAL_TRANLATED] = 0;
                }, 1000);
                break;
            default:
                return false;
        }
        // #NOTES: DEBUGGING

    }
}

export default new EventManager();