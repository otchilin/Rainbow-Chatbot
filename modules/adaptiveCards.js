const ACData = require("adaptivecards-templating");

const fs = require('fs');
const pathUtil = require('path');
const fsPromises = fs.promises;

'use strict';
const LOG_ID = "ACDHelper - ";

class ACDHelper {

    constructor() {
        this._logger = null;
        this._templates = {};
        this._templatesPath = null;
    }

    async start(logger, templatesPath) {
        this._logger = logger;
        this._templatesPath = templatesPath;

        if (templatesPath !== "") {
            let tmpls = await this.loadTemplates();
            console.log(tmpls);
        } else {
            throw ("ADC templates path is empty !");
        }
    }

    checkTemplate(templateName){
        return this._templates && this._templates[templateName] !== 'undefined';
    }

    genCard(templateName, data) {
        return new Promise((resolve, reject) => {

            if (!this.checkTemplate(templateName)) {
                reject("Template unknown !")
            }

            // Create a Template instance from the template payload
            const template = new ACData.Template(this._templates[templateName]);

            // Create a data binding context, and set its $root property to the
            // data object to bind the template to
            const context = {
                $root: data
            };

            // "Expand" the template - this generates the final Adaptive Card,
            // ready to render
            const card = template.expand(context);

            resolve(card);
        });
    }


    async loadTemplates() {

        let files = null;
        try {
            files = await fsPromises.readdir(this._templatesPath);
        } catch (err) {
                this.log("error", LOG_ID + "loadTemplates() - Error while reading template dir");
                return;
        }

        if (files.length > 0) {

            let filesList = files.filter(function (e) {
                return pathUtil.extname(e).toLowerCase() === '.json'
            });

            if (filesList.length > 0) {
                let promises = [];
                filesList.forEach(filePath => {
                    promises.push(
                        fsPromises.readFile(pathUtil.join(this._templatesPath, '/', filePath), 'utf8')
                    );
                });

                let resultArray = await Promise.all(promises);

                for (let i = 0; i < filesList.length; i++) {
                    try {
                        this._templates[pathUtil.basename(filesList[i], '.json')] = JSON.parse(resultArray[i]);
                    } catch (e) {
                        this.log("error", LOG_ID + "loadTemplates() - Error while extracting template : " + filesList[i]);
                        return;
                    }

                }

                this.log("i", LOG_ID + "loadTemplates() - " + this._templates.length + " templates loaded successfully");

            }
        }

    }

    log(level, message, content) {
        if (this._logger) {
            this._logger.log(level, message);
        } else {
            console.log(message, content);
        }
    }
}

module.exports = ACDHelper;
