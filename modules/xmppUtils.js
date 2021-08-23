"use strict";

const {v4: uuidv4} = require('uuid');

class XMPPUTils {

    constructor() {
        this.messageId = 0;
    }

    generateRandomID() {
        var text = "";
        var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

        for (var i = 0; i < 8; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    getUniqueMessageId() {

        var randomBase = uuidv4();

        var messageToSendID = "node_" + randomBase + this.messageId;
        this.messageId++;
        return messageToSendID;
    }

    generateRandomFullJidForNode(jid) {
        var fullJid = jid + "/node_" + this.generateRandomID();
        return fullJid;
    }

    getBareJIDFromFullJID(fullJid) {
        var index = 0;

        if (fullJid.indexOf("tel_") === 0) {
            index = 4;
        }

        return fullJid.substring(index, fullJid.indexOf("/"));
    }

    getUsernameFromJid(jid) {
        var index = 0;

        if (jid.indexOf("tel_") === 0) {
            index = 4;
        }
        return jid.substring(index, jid.indexOf("@"));
    }

    isFromMobile(fullJid) {
        return (fullJid.indexOf("mobile") > -1);
    }

    isFromNode(fullJid) {
        return (fullJid.indexOf("node") > -1);
    }

    isFromTelJid(fullJid) {
        return (fullJid.indexOf("tel_") === 0);
    }

    getResourceFromFullJID(fullJid) {
        return fullJid.substring(fullJid.indexOf("/") + 1);
    }
}

module.exports = new XMPPUTils();
