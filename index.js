"use strict";

const Promise = require("bluebird");
const bhttp = require("bhttp");
const moment = require("moment");
const colors = require("colors");
const crypto = require("crypto");
const childProcess = require("child_process");
const jsonfile = Promise.promisifyAll(require("jsonfile"));
const fs = require("fs");

const captureDirectory = "captures/";
const broadcastsDirectory = "broadcasts/";

const [action, bcast, pass] = process.argv.slice(2);
if("undefined" === typeof action || "undefined" === typeof bcast) {
    logError("Missing required params.");
    return;
}

const BASE_URL = "/moc.irtoms//:ptth".split("").reverse().join("");

process.on("SIGINT", function () {
    if("undefined" !== typeof capture.process) {
        capture.process.kill("SIGKILL");

        const path = captureDirectory + capture.process.fileName;
        if (!fs.statSync(path).size) {
            fs.unlink(path);
        }
    }
    process.exit(0);
});

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
    const ticket = html.match(new RegExp(/&amp;file=(.*)&amp;/));
    if(ticket && "string" === typeof ticket[1]) {
        return ticket[1];
    } else {
        if(-1 < html.indexOf("Трансляция не найдена")) {
            throw new Error("Broadcast not found");
        } else if(-1 < html.indexOf("Трансляция не одобрена модератором")) {
            throw new Error("Broadcast banned");
        } else if(-1 < html.indexOf("Страница не найдена")) {
            throw new Error("Page not found");
        } else if(-1 < html.indexOf("Юзер не найден")) {
            throw new Error("User not found");
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
    if(pass) {
        data.pass = crypto.createHash("md5").update(pass).digest('hex');
    }
    log(url);
    return bhttp.post(url, data);
}).then(function(response) {
    const html = response.body.toString();
    let json;
    try {
        json = JSON.parse(html);
    } catch(error) {
        logError("JSON parse error");
    }
    if(json._pass_protected) {
        if(pass) {
            throw new Error("Wrong password");
        } else {
            throw new Error("Password protected");
        }
    }
    delete json._pass_protected;
    delete json._vidURL;
    delete json._chatURL;
    delete json._chat_server;
    delete json.begun_url_1;
    delete json.begun_url_2;
    delete json.begun_url_3;
    delete json.begun_url_4;
    delete json.video_id;
    delete json.author_id;
    delete json.fakestatus;
    delete json.remote_ip;
    delete json.save_error;
    delete json.rubric_broadcastlink;
    if(!!json._imgURL && "//pics." === json._imgURL.substr(0,7)) {
        delete json._imgURL;
    }
    logSuccess(json);
    storeBroadcastData(json);
    return json;
}).then(function(json) {
    capture(json);
}).catch(function(error) {
    logError(error.toString().split("Error: ").pop());
});

function storeBroadcastData(json) {
    const bid = json._streamName.split("_")[1];
    const path = broadcastsDirectory + parseInt(bid) + ".json";
    return jsonfile.writeFile(path, json);
}

function capture(json) {
    const fileName = [
        json._streamName.split("_").slice(0,2).join("_"),
        moment().format("YYYYMMDDHHmmss"),
        json.login
    ].join("_") + ".flv";

    return Promise.try(function() {
        const spawnArgs = [
            "-v",
            "-m", 3600,
            "-r", json._server + "/" + json._streamName,
            "-a", "broadcast/" + json._streamName,
            "-f", "WIN 12,0,0,77",
            "-W", "fws.yalp_tsacdaorb/moc.irtoms.scip//:ptth".split("").reverse().join(""),
            "-C", "S:00000000000000000000000000000000",
            "-y", json._streamName,
            "-o", captureDirectory + fileName
        ];

        const captureProcess = childProcess.spawn('rtmpdump', spawnArgs);
        capture.process = captureProcess;
        capture.process.fileName = fileName;

        captureProcess.stderr.on('data', function(data) {
            let txt = data.toString().trim();
            const omitedMessages = [
                "Caught signal: 2",
                "RTMPDump v",
                "INFO: Metadata"
            ];
            for(const begin of omitedMessages) {
                if(txt.indexOf(begin) === 0) return;
            }
            if("INFO: Connected..." === txt) {
                txt = "Connected";
            }
            log(txt);
        });

        captureProcess.on('error', function(error) {
            throw error;
        });

        captureProcess.on('close', function(code) {
            log("Disconnected");
            capture(json);
        });

        log("Start recording " + colors.green(json.login));
    }).catch(function(error) {
        logError(error.toString());
    });
}

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
