"use strict";

const EventEmitter = require("events");

const NodeSDK = require("./modules/sdk");
const Logger = require("./modules/logger");
const Queue = require("./modules/queue");
const Work = require("./modules/work");
const pkg = require("./package.json");
const Tags = require("./modules/tags");
const Works = require("./modules/works");
const Delayer = require("./modules/delayer");
const Factory = require("./modules/plugins/factory");

const adcHelper = require("./modules/adaptiveCards.js");
const promClient = require("prom-client");

const LOG_ID = "CHATBOT - ";

class RainbowAgent {

    constructor(nodeSDK, tags, options) {

        process.on("uncaughtException", (err) => {
            console.error(err);
        });

        process.on("warning", (err) => {
            console.error(err);
        });

        process.on("unhandledRejection", (err) => {
            console.error(err);
        });

        // Initialize component
        this.options = options;
        this.logger = Logger;
        if (options && options.logs) {
            this.logger.setLevel((options.logs.level) || 'debug');
        }
        this.events = new EventEmitter();
        this.queue = new Queue();
        this.tags = new Tags(tags);
        this.sdk = new NodeSDK(nodeSDK, options.sdk);
        this.works = new Works(this.sdk, options.works);
        this.delayer = new Delayer();
        this.factory = new Factory();

        this.adcHelper = new adcHelper();

        // Callback for onMessage()
        this._callbackMessage = null;
        this._contextMessage = null;

        // Callback for onTicket()
        this._callbackTicket = null;
        this._contextTicket = null;

        this._isEnabled = true;

        this._messageReceivedBadCounter = new promClient.Counter({
            name: 'botsdk_bad_message_received_total',
            help: 'Total number of bad message received by the bot (no corresponding work)'
        });

        this._promRegistry = promClient.register;

        return this;
    }

    enable() {
        this._isEnabled = true;
        this.logger.log("warn", LOG_ID + "enable() - Mode is enabled");
    }

    disable() {
        this._isEnabled = false;
        this.logger.log("warn", LOG_ID + "disable() - Mode is disabled");
        this.works.purge();
    }

    get state() {
        return this._isEnabled;
    }

    version() {
        return pkg.version;
    }

    start() {

        let that = this;

        this.logger.log("debug", LOG_ID + "------------------------------------------------");
        this.logger.log("debug", LOG_ID + "welcome() - Welcome to Rainbow ChatBot");
        this.logger.log("info", LOG_ID + "welcome() - v" + pkg.version);

        this.logger.log("info", LOG_ID + "start() - Start services...");

        this.sdk.start(this.events, this.logger).then(() => {
        }).then(() => {
            return that.delayer.start(that.events, that.logger);
        }).then(() => {
            if (that.options && that.options.adaptivecards && that.options.adaptivecards.path !== '') {
                return that.adcHelper.start(that.logger, that.options.adaptivecards.path);
            }
        }).then(() => {
            return that.factory.start(that.events, that.logger, that.adcHelper);
        }).then(() => {
            return that.queue.start(that.events, that.logger, that.options);
        }).then(() => {
            return that.tags.start(that.events, that.logger);
        }).then(() => {
            return that.works.start(that.events, that.logger, that.factory);
        }).then(() => {
            that.logger.log("info", LOG_ID + "start() - All services started successfully!");

            that.logger.log("info", LOG_ID + "start() - Ready to listen incoming requests...");

            that.addPostListener();

        }).catch((err) => {
            that.logger.log("error", LOG_ID + "start() - Error starting " + err);
        });
    }

    onMessage(func, context) {
        this._callbackMessage = func;
        this._contextMessage = context;
    }

    onTicket(func, context) {
        this._callbackTicket = func;
        this._contextTicket = context;
    }

    fireEvent(work, message) {

        let that = this;

        return new Promise((resolve) => {

            if (!that._callbackMessage) {
                resolve();
            } else {

                let content = message ? message.value : "";

                return that._callbackMessage.call(that._contextMessage, work.tag, work.stepId, content, work.from, resolve);
            }

        });
    }

    fireTicketEvent(work) {
        this._callbackTicket.call(this._contextTicket, work.tag, work.history, work.from, work.createdOn, work.endedOn, work.state, work.id);
    }

    addPostListener() {

        let that = this;

        // Listen message from users (new tasks or answers)
        this.events.on("onmessagereceived", (msg) => {
            let work = null;

            if (this._isEnabled) {

                // Qualify message (check tag)
                let scenario = that.tags.qualify(msg);

                // Get work if exists
                work = that.works.getWork(msg, scenario);

                // Add to queue if work
                if (!work) {
                    this._messageReceivedBadCounter.inc();
                    that.logger.log("warn", LOG_ID + "onmessagereceived() - Incorrect message received");
                    return;
                }

                if (work.queued) {
                    that.logger.log("warn", LOG_ID + "onmessagereceived() - Existing work is running. No user input expected...");
                    return;
                }

                // Store message if scenario is inProgress
                if (work.state === Work.STATE.INPROGRESS) {

                    if (!this.factory.isValid(work, work.scenario[work.stepId], msg.value, msg.altContent)) {
                        return;
                    }
                    work.historize(msg);
                }

                that.fireEvent(work, msg).then((routedStep) => {

                    if (routedStep) {
                        // force next step
                        work.forcedNextStep = routedStep;
                    }

                    if (work.waiting) {
                        that.delayer.delay(work);
                    } else {
                        that.queue.addToQueue(work);
                    }
                });
            } else {
                that.logger.log("warn", LOG_ID + "onmessagereceived() - Input not taken into account. Mode is disabled...");
            }
        });

        // Listen when work has finished a task
        this.events.on("ontaskfinished", (work) => {

            if (work.state !== Work.STATE.CLOSED &&
                work.state !== Work.STATE.BLOCKED &&
                work.state !== Work.STATE.ABORTED &&
                work.state !== Work.STATE.TIMEOUT &&
                !work.pending) {

                if (that._isEnabled) {
                    if (work.external) {

                        that.fireEvent(work, null).then((routedStep) => {

                            work.external = false;

                            if (routedStep) {
                                // force next step
                                work.forcedNextStep = routedStep;
                            }

                            if (work.waiting) {
                                that.delayer.delay(work);
                            } else {
                                that.queue.addToQueue(work);
                            }
                        });

                    } else {
                        if (work.waiting) {
                            that.delayer.delay(work);
                        } else {
                            that.queue.addToQueue(work);
                        }
                    }
                } else {
                    that.logger.log("warn", LOG_ID + "onmessagereceived() - Input not taken into account. Mode is disabled...");
                }
            } else {
                if (work.pending) {
                    that.logger.log("info", LOG_ID + "ontaskfinished() - Work[" + work.id + "] is waiting for incoming inputs...");
                } else {
                    that.logger.log("info", LOG_ID + "ontaskfinished() - Work [" + work.id + "] is closed, blocked or aborted");

                    work.endedOn = new Date();

                    that.fireTicketEvent(work);

                    // Work is completely finished, we can remove this job from "works" array
                    that.works.removeWork(work);
                }
            }
        });

        this.events.on('ontaskexternal', (work) => {

            that.fireEvent(work, null).then((routedStep) => {

                if (routedStep) {
                    // force next step
                    work.forcedNextStep = routedStep;
                }

                if (work.waiting) {
                    that.delayer.delay(work);
                } else {
                    that.queue.addToQueue(work);
                }
            });

        });
    }
}

module.exports = RainbowAgent;
