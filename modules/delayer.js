"use strict";

const LOG_ID = "DELAYER - ";
const promClient = require("prom-client");

class Delayer {

    constructor() {
        this._event = null;
        this._logger = null;
        this._workDelayed = {};

        this._workDelayedGauge = new promClient.Gauge({
            name: 'botsdk_work_delayed_length',
            help: 'Current number of work waiting in delayed mode'
        });
    }

    start(event, logger) {
        this._event = event;
        this._logger = logger;

        return new Promise(function (resolve) {
            resolve();
        });
    }

    get listOfDelayed() {
        return this._workDelayed;
    }

    log(level, message, content) {
        if (this._logger) {
            this._logger.log(level, message);
        } else {
            console.log(message, content);
        }
    }

    delayed(work) {
        this.log("debug", LOG_ID + "delay() - Resume work[" + work.id + "]");
        work.waiting = 0;
        this._workDelayed[work.id] = null;
        delete this._workDelayed[work.id];
        this._workDelayedGauge.set(Object.keys(this._workDelayed).length);
        this._event.emit("ontaskfinished", work);
    }

    delay(work) {
        let that = this;

        this.log("debug", LOG_ID + "delay() - Delay work[" + work.id + "] for " + work.waiting);

        this._workDelayed[work.id] = work;

        this._workDelayedGauge.set(Object.keys(this._workDelayed).length);
        setTimeout(() => {
            that.delayed(work);
        }, work.waiting);
    }
}

module.exports = Delayer;
