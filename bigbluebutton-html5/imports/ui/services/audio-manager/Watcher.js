import { useState, useEffect, useRef } from 'react';

class Watcher {
    constructor() {
        this.subscribers = new Set();
        this.state = new Map();
    }

    // Subscribe a component's update function
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => {
            this.subscribers.delete(callback);
        };
    }

    // Notify all subscribers to update
    notify() {
        this.subscribers.forEach(callback => callback());
    }

    // Set a value and trigger updates
    setValue(key, value) {
        this.state.set(key, value);
        this.notify();
    }

    // Get a value
    getValue(key) {
        return this.state.get(key);
    }

    // Delete a value
    deleteValue(key) {
        this.state.delete(key);
        this.notify();
    }

    // Clear all values
    clear() {
        this.state.clear();
        this.notify();
    }
}

// React Hook to use the Watcher
export function useWatcher(watcher) {
    const [, forceUpdate] = useState({});

    useEffect(() => {
        // Subscribe to updates
        const unsubscribe = watcher.subscribe(() => {
            forceUpdate({});
        });

        // Cleanup subscription
        return () => {
            unsubscribe();
        };
    }, [watcher]);

    return watcher;
}

export { Watcher };