"use strict";

const LOG_ID = "SDK - ";

const serialize = require('safe-stable-stringify');
const Message = require('./message');
const promClient = require('prom-client');

class SDK {

    constructor(nodeSDK, options = {}) {
        this._nodeSDK = nodeSDK;
        this._event = null;
        this._logger = null;
        this._usersCache = {};
        this._options = options || {};

        this._messageSentCounter = new promClient.Counter({
            name: 'botsdk_message_sent_total',
            help: 'Total number of message sent by the bot'
        });
        this._messageReceivedCounter = new promClient.Counter({
            name: 'botsdk_message_received_total',
            help: 'Total number of message received by the bot'
        });
        this._messageReceivedFilteredCounter = new promClient.Counter({
            name: 'botsdk_message_filtered_received_total',
            help: 'Total number of message received by the bot after filter'
        });
    }

    start(event, logger) {

        this._event = event;
        this._logger = logger;

        return new Promise((resolve, reject) => {
            this.listenToSDKError();
            this.listenToSDKConnectionError();
            this.listenToIncomingMessage();
            this.listenToOutgoingMessage();
            resolve();
        });
    }

    listenToSDKError() {
        this._nodeSDK.events.on("rainbow_onerror", (jsonMessage) => {
            this._logger.log("debug", LOG_ID + "listenToSDKError() - Error!", jsonMessage);
        });
    }

    listenToSDKConnectionError(){
        //TODO Manage system re-connection after this event fatal connection failure
        this._nodeSDK.events.on("rainbow_onfailed", (jsonMessage) => {
            this._logger.log("error", LOG_ID + "listenToSDKConnectionError() - Fatal!", jsonMessage);
        });

    }

    listenToIncomingMessage() {
        this._nodeSDK.events.on("rainbow_onmessagereceived", (message) => {

            this._messageReceivedCounter.inc();
            // Do not deal with messages sent by the bot or the bot identity connected in web, mobile...
            if (!message.cc) {
                this._messageReceivedFilteredCounter.inc();

                if (this._options.markMessageAsRead === undefined || this._options.markMessageAsRead) {
                    this._nodeSDK.im.markMessageAsRead(message);
                }

                this.getContact(message.fromJid).then(contact => {
                    let msgType = Message.MESSAGE_TYPE.MESSAGE;
                    if (message.alternativeContent && message.alternativeContent.length > 0) {
                        msgType = Message.MESSAGE_TYPE.FORMSUBMIT;
                    }
                    let msg = new Message({
                        type: msgType,
                        jid: message.fromJid,
                        from: contact,
                        value: message.content,
                        lang: message.lang,
                        date: new Date(),
                        altContent: message.alternativeContent[0]
                    });

                    this._logger.log("debug", LOG_ID + "listenToIncomingMessage() - Received " + msg.type);

                    this._event.emit("onmessagereceived", msg);
                });
            }
        });

        this._nodeSDK.events.on("rainbow_onmessagereceiptreceived", (receipt) => {
            this._event.emit("onreceiptreceived", receipt);
        });
    }

    listenToOutgoingMessage() {
        this._event.on("onSendMessage", (json) => {
            this.sendAMessage(json.message, json.jid, json.type, json.extendedContent);
        });
    }

    getContact(jid) {

        this._logger.log("debug", LOG_ID + "getContact() - Enter");

        return new Promise((resolve, reject) => {
            if (!(jid in this._usersCache)) {
                // get information on the contact by Jid
                this._nodeSDK.contacts.getContactByJid(jid).then((user) => {
                    this._usersCache[jid] = user;
                    this._logger.log("info", LOG_ID + "getContact() - Found on server");
                    this._logger.log("debug", LOG_ID + "getContact() - Exit");
                    resolve(user);
                }).catch((err) => {
                    this._logger.log("error", LOG_ID + "getContact() - Error", err);
                    this._logger.log("debug", LOG_ID + "getContact() - Exit");
                    reject(err);
                });

            } else {
                this._logger.log("debug", LOG_ID + "getContact() - Found in cache");
                this._logger.log("debug", LOG_ID + "getContact() - Exit");
                resolve(this._usersCache[jid]);
            }
        });
    }

    getContactById(id) {

        this._logger.log("debug", LOG_ID + "getContactById() - Enter");

        return new Promise((resolve, reject) => {
            // get information on the contact by ID
            this._nodeSDK.contacts.getContactById(id).then((user) => {
                this._logger.log("info", LOG_ID + "getContactById() - Found");
                this._logger.log("debug", LOG_ID + "getContactById() - Exit");
                resolve(user);
            }).catch((err) => {
                this._logger.log("error", LOG_ID + "getContactById() - Error", err);
                this._logger.log("debug", LOG_ID + "getContactById() - Exit");
                reject(err);
            });
        });
    }

    sendAMessage(message, jid, type, content) {

        let extContent = null;

        /**
         * Process alternative content
         */
        if (content) {

            switch (type) {
                case "form/json":
                case "application/json":

                    if (typeof (content) !== "string") {
                        content = serialize.default(content);
                    }

                    break;
                case "text/markdown":
                    if (typeof (content) !== "string") {

                        this._logger.log("error", LOG_ID + "sendAMessage() - Message content is not MD format");
                        return;
                    }
                    break;
                default:
            }

            extContent = {
                type: type,
                message: content
            };
        }

        this._nodeSDK.im.sendMessageToJid(message, jid, "en", extContent);
        this._messageSentCounter.inc();
    }
}

module.exports = SDK;
