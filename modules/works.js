"use strict";

const Work = require("./work");
const Message = require("./message");
const _ = require("lodash");
const promClient = require("prom-client");

const LOG_ID = "WORKS - ";

class Works {

    /**
     * @param nodeSDK
     * @param timeout max idle time in sec for a scenario
     */
    constructor(nodeSDK, timeout = 600) {
        this._event = null;
        this._logger = null;
        this._factory = null;
        this._nodeSDK = nodeSDK;
        this._works = [];
        this._timeoutLimit = timeout * 1000; // In ms

        this._counter_processed_works_total = new promClient.Counter({
            name: 'botsdk_processed_scenario_total',
            help: 'Total number of scenario processed',
        });

        this._gauge_scenarios = new promClient.Gauge({
            name: 'botsdk_processing_scenarios',
            help: 'Total number of currently running scenarios/conversation'
        });

        this._counter_error_works_total = new promClient.Counter({
            name: 'botsdk_scenario_end_error_total',
            help: 'Total number of scenario which ended in error state (abort, timeout, etc)',
        });

        this._watchDogH = setInterval(this.workWatchDog, this._timeoutLimit, this);
    }

    workWatchDog($this) {
        let now = Date.now();
        $this._works.forEach((work) => {
            if (now - work.lastChange > $this._timeoutLimit) {
                work.timeout();
                $this._event.emit("ontaskfinished", work);
            }
        });
    }

    start(event, logger, factory) {

        let that = this;

        return new Promise((resolve) => {
            that._logger = logger;
            that.log("debug", LOG_ID + "start() - Enter");
            that._event = event;
            that._factory = factory;
            that.log("debug", LOG_ID + "start() - Exit");
            resolve();
        });
    }

    log(level, message, content) {
        if (this._logger) {
            this._logger.log(level, message);
        } else {
            console.log(message, content);
        }
    }

    get listOfWorks() {
        return this._works;
    }

    addWork(work) {
        this._counter_processed_works_total.inc();
        this._works.push(work);
        this._gauge_scenarios.set(this._works.length);
        this.log("debug", LOG_ID + "addWork() - number of work(s) " + this._works.length);
    }

    getWorkByJid(jid) {
        return this._works.find((work) => {
            return (work.jid === jid && !work.isFinished && !work.isAborted && !work.isBlocked);
        });
    }

    purge() {
        this._works.forEach((work) => {
            // purge opened tickets from the base when chatbot is stopped
            if (work.state === Work.STATE.INPROGRESS ||
                work.state === Work.STATE.NEW ||
                work.state === Work.STATE.BLOCKED ||
                work.state === Work.STATE.TERMINATED) {

                work.abort();
                this._event.emit("ontaskfinished", work);
            }
        });
    }

    getWork(message, scenario) {

        let createWork = (jid, tag, from, scenario, step) => {
            let work = new Work(this._event, this._logger, this._factory);
            work.jid = jid;
            work.tag = tag;
            work.from = from;
            work.scenario = scenario;

            if (step && work.scenario[step]) {
                //work.stepId = step;
                work.forcedNextStep = step;
                //work._state = Work.STATE.JUMP;
            }
            return work;
        };

        let work = this.getWorkByJid(message.jid);

        // Create new work if tag + no existing work
        if (!work) {
            if (message.type === Message.MESSAGE_TYPE.COMMAND) {
                work = createWork(message.jid, message.tag, message.from, scenario, message.params[0]);
                this.log("info", LOG_ID + "getWork() - Create new work " + work.id + " | "
                    + work.tag + " optional step " + message.params[0]);
                this.addWork(work);
            } else {
                this.log("warn", LOG_ID + "getWork() - No existing work found for that message");
            }
            // Reuse existing work
        } else {
            // If command send, abort current work and create a new one
            // If this is a command jump inside existing work, we simply move in scenario
            if (message.type === Message.MESSAGE_TYPE.COMMAND) {
                if (work.tag === message.tag) {
                    if (message.params[0]) {
                        // Jump to desired step
                        if (work.scenario[message.params[0]]) {
                            work.forcedNextStep = message.params[0];
                            work._state = Work.STATE.JUMP;

                            this.log("info", LOG_ID + "getWork() - Jumping to step " + work.stepId
                                + " work " + work.id + " | " + work.tag);
                        }
                    } else {
                        // We simply restart scenario
                        work.forcedNextStep = work.getFirstStep();
                        work._state = Work.STATE.JUMP;
                        this.log("info", LOG_ID + "getWork() - Restarting scenario / work "
                            + work.id + " | " + work.tag);
                    }
                    return work;

                } else {
                    // User asked to change the current scenario
                    // We abort the current one and start a new one
                    // note : The tag validity has been verified by previous module
                    this.log("info", LOG_ID + "getWork() - Switch to scenario " + message.tag
                        + ", Abort Current work " + work.id + " | " + work.tag);
                    work.abort();
                    this._event.emit("ontaskfinished", work);

                    work = createWork(message.jid, message.tag, message.from, scenario, message.params[0]);
                    this.log("info", LOG_ID + "getWork() - Create new work " + work.id + " | " + work.tag);
                    this.addWork(work);
                }

            } else {
                work.pending = false;
                this.log("debug", LOG_ID + "getWork() - Continue Work[" + work.id + "] (state) '" + work.state + "'");
            }
        }
        return work;
    }

    removeWork(work) {

        if ([Work.STATE.BLOCKED, Work.STATE.TIMEOUT].includes(work.state)) this._counter_error_works_total.inc();

        // Find & remove the corresponding task
        let removed = _.remove(this._works, function (o) {
            return o.jid === work.jid && o.tag === work.tag && o.from === work.from;
        });
        if (removed.length) {
            this._gauge_scenarios.set(this._works.length);
            this.log("info", LOG_ID + "removeWork() - Removed Work[" + work.id + "] (state) '" + work.state + "'");
        } else {
            this.log("error", LOG_ID + "removeWork() - Work[" + work.id + "] (state) '" + work.state + "' not found !");
        }

    }
}

module.exports = Works;
