/**
 * Event Manager Module
 * 
 * Handles loading the list of available events from events.json
 * 
 * @module EventManager
 * @version 2.0.0
 * 
 * Usage:
 * ```javascript
 * import { EventManager } from './events.js';
 * 
 * const manager = new EventManager();
 * const events = await manager.loadEvents();
 * // events = [{ id: 'default', name: 'Default Event', description: '...' }, ...]
 * ```
 */

'use strict';

/**
 * EventManager class - loads event list from events.json
 */
export class EventManager {
    constructor(basePath = 'events') {
        this.basePath = basePath;
        this.events = [];
        this.loaded = false;
    }

    /**
     * Load the events list from events.json
     * @returns {Promise<Array>} - List of events
     */
    async loadEvents() {
        try {
            const response = await fetch(`${this.basePath}/events.json`);
            if (!response.ok) {
                throw new Error(`Failed to load events: ${response.status}`);
            }

            const data = await response.json();
            this.events = data.events || [];
            this.loaded = true;

            console.log(`Loaded ${this.events.length} events`);
            return this.events;

        } catch (error) {
            console.error('Failed to load events:', error);
            this.events = [];
            this.loaded = true;
            return [];
        }
    }

    /**
     * Get the list of events
     * @returns {Array<Object>} - Array of {id, name, description}
     */
    getEvents() {
        return this.events;
    }

    /**
     * Get event by ID
     * @param {string} eventId 
     * @returns {Object|null}
     */
    getEvent(eventId) {
        return this.events.find(e => e.id === eventId) || null;
    }

    /**
     * Check if events are loaded
     * @returns {boolean}
     */
    isLoaded() {
        return this.loaded;
    }

    /**
     * Get number of events
     * @returns {number}
     */
    getEventCount() {
        return this.events.length;
    }
}

// For non-module usage
if (typeof window !== 'undefined') {
    window.EventManager = EventManager;
}

export default EventManager;
