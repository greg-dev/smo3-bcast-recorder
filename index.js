"use strict";

const Promise = require("bluebird");
const bhttp = require("bhttp");
const moment = require("moment");
const colors = require("colors");

const [action, bcast] = process.argv.slice(2);
if("undefined" === typeof action || "undefined" === typeof bcast) {
    logError("Missing required params.");
    return;
}

const BASE_URL = "/moc.irtoms//:ptth".split("").reverse().join("");

Promise.try(function() {
    // get proper page with brodcast tickets
    if(bcast === bcast.replace(/\D/g,"")){
        // use broadcast id
        const url = BASE_URL + "broadcast/view?id=" + bcast;
        log(url);
        return bhttp.get(url);
    } else {
        // use broadcaster login
        const url = BASE_URL + "live/" + bcast + "/";
        log(url);
        return bhttp.get(url);
    }
}).then(function(response) {
    // find broadcast ticket
    const html = response.body.toString();
    const ticket = html.match(new RegExp(/addFlashVar\('file', '(.*)'\)/));
    if(ticket && "string" === typeof ticket[1]) {
        return ticket[1];
    } else {
        if(-1 < html.indexOf("Трансляция не найдена")) {
            throw new Error("Broadcast not found");
        } else {
            throw new Error("Ticket unavailable");
        }
    }
}).then(function(ticket) {
    // get broadcast data
    const url = BASE_URL + "broadcast/view/url/?xt=" + ticket;
    const data = {
        ticket,
        sid: "0".repeat(32)
    };
    log(url);
    return bhttp.post(url, data);
}).then(function(response) {
    const html = response.body.toString();
    try {
        const json = JSON.parse(html);
        logSuccess(json);
        return json;
    } catch(error) {
        logError("JSON parse error");
    }
}).catch(function(error) {
    logError(error.toString().split("Error: ").pop());
});

function currentDateTime() {
    return moment().format("YYYY-MM-DD HH:mm:ss");
}

function log(txt) {
    console.log(colors.blue("["+currentDateTime()+"]"), txt);
}

function logSuccess(txt) {
    console.log(colors.green("["+currentDateTime()+"]"), txt);
}

function logError(txt) {
    console.log(colors.blue("["+currentDateTime()+"]"), colors.red("[ERROR]"), txt);
}
