"use strict";

const async = require("async");
const Work = require("./work");
const promClient = require("prom-client");

const LOG_ID = "QUEUE - ";

class Queue {

    // This class is used to debounce messages that come to the bot to allow a better scaling
    constructor() {
        this._event = null;
        this._logger = null;
        this._queue = null;
        this._options = null;
        this._timeout = {};

        this._queueLoopCount = new promClient.Counter({
            name: 'botsdk_queue_loop_total',
            help: 'Total number of times the queue worker has been called',
        });

        this._queueLengthGauge = new promClient.Gauge({
            name: 'botsdk_queue_length',
            help: 'Current scenario queue size'
        });

    }


    /**
     * Clear the timeout handle for corresponding work
     * @param work
     */
    removeTimeout(work) {
        if (this._timeout[work.id]) {
            clearTimeout(this._timeout[work.id]);
            delete this._timeout[work.id];
        }
    }

    start(event, logger, options) {

        let that = this;

        return new Promise((resolve) => {
            that._logger = logger;
            that._logger.log("debug", LOG_ID + "start() - Enter");
            that._event = event;
            that._options = options;
            that.createQueue();
            that._logger.log("debug", LOG_ID + "start() - Exit");
            resolve();
        });
    }

    createQueue() {

        let that = this;

        this._logger.log("debug", LOG_ID + "createQueue() - Enter");

        this._queue = async.queue(function (work, callback) {
            that._logger.log("info", LOG_ID + "Queue worker - Executing next work");
            that.executeWork(work).then(() => {
                callback(null);
            }).catch((err) => {
                that._logger.log("error", LOG_ID + "Queue worker  - Error", err);
                callback(err);
            });
        }, (this._options && this._options.queue && this._options.queue.concurrency) ? this._options.queue.concurrency : 1);

        this._queue.drain(() => {
            that._logger.log('debug', LOG_ID + "Queue worker - all works have been processed");
        });

        this._queue.error(function (err, work) {
            that._logger.log("error", LOG_ID + "Queue worker - work " + work.id + "experienced an error: ", err);
        });

        this._logger.log("debug", LOG_ID + "createQueue() - Exit");
    }

    rejectExpiredWork(work, timeout) {
        return (() => {
            return new Promise((resolve, reject) => {
                this._timeout[work.id] = setTimeout(() => {
                    this._logger.log("debug", LOG_ID + "rejectExpiredWork() - work ID = " + work.id);
                    reject(`the Work ${work.id} took too much time, it was cancelled`);
                }, timeout * 1000);


            })
        })();
    }

    executeWork(work) {

        this._queueLoopCount.inc();

        let that = this;

        that._logger.log("debug", LOG_ID + "executeWork() - Enter");

        let workPromise = new Promise((resolve) => {

            that._logger.log("info", LOG_ID + "executeWork() - Execute work " + work.id + " | " + work.state);

            switch (work.state) {

                case Work.STATE.NEW:
                    work.next();
                    that._logger.log("debug", LOG_ID + "executeWork() - Exit from state NEW");
                    resolve();
                    break;
                case Work.STATE.JUMP:
                    work.jump();
                    work.executeStep();
                    work.next();
                    that._logger.log("debug", LOG_ID + "executeWork() - Exit from state JUMP");
                    resolve();
                    break;
                case Work.STATE.INPROGRESS:

                    work.move();
                    work.executeStep();
                    if (work.hasNoMoreStep()) {
                        work.next();
                    }
                    that._logger.log("debug", LOG_ID + "executeWork() - Exit");
                    resolve();
                    break;
                case Work.STATE.TIMEOUT:
                case Work.STATE.TERMINATED:
                    work.next();
                    that._logger.log("debug", LOG_ID + "executeWork() - Exit");
                    resolve();
                    break;
                case Work.STATE.CLOSED:
                    that._logger.log("debug", LOG_ID + "executeWork() - Case closed");
                    that._logger.log("debug", LOG_ID + "executeWork() - Exit");
                    resolve();
                    break;
                default:
                    that._logger.log("warn", LOG_ID + "executeWork() - Incorrect state", work.state);
                    resolve();
                    break;
            }
        });

        if (that._options && this._options.queue && this._options.queue.maxTaskDuration) {
            let duration = Number.parseInt(this._options.queue.maxTaskDuration, 10)
            duration = duration < 60 ? duration : 60;
            return Promise.race([workPromise, that.rejectExpiredWork(work, duration)])
        } else {
            return workPromise;
        }
    }

    addToQueue(work) {
        this._logger.log("debug", LOG_ID + "addToQueue() - Enter");
        this._logger.log("info", LOG_ID + "addToQueue() - Push work for user " + work.jid + "in state " + work.state);
        work.queue = true;

        this._queue.push(work, (err) => {

            this._queueLengthGauge.set(this._queue.length());

            if (err) {
                this._logger.log("error", LOG_ID + "addToQueue() - Error processing " + work.jid);
                this._logger.log('error', LOG_ID + "addToQueue() - err:" + err);
                work.timeout();
                this._event.emit("ontaskfinished", work);
                return;
            }

            // Clear timeout watchdog
            this.removeTimeout(work);

            this._logger.log("info", LOG_ID + "addToQueue() - Finished work for " + work.jid);

            work.queued = false;

            this._event.emit("ontaskfinished", work);

        });

        this._queueLengthGauge.set(this._queue.length());
        this._logger.log("debug", LOG_ID + "addToQueue() - Exit");
    }
}

module.exports = Queue;
