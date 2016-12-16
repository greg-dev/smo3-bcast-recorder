'use strict';

/* eslint-disable no-console, no-use-before-define, prefer-template, no-underscore-dangle */
const Promise = require('bluebird');
const bhttp = require('bhttp');
const moment = require('moment');
const colors = require('colors');
const crypto = require('crypto');
const childProcess = require('child_process');
const jsonfile = Promise.promisifyAll(require('jsonfile'));
const fs = require('fs');

const captureDirectory = 'captures/';
const broadcastsDirectory = 'broadcasts/';

const [action, bcast, pass] = process.argv.slice(2);
if (undefined === action || undefined === bcast) {
  logError('Missing required params.');
  process.exit(0);
}

const BASE_URL = '/moc.irtoms//:ptth'.split('').reverse().join('');

Promise.try(() => {
  let url;
  // get proper page with brodcast tickets
  if (bcast === bcast.replace(/\D/g, '')) {
    // use broadcast id
    url = BASE_URL + 'broadcast/view?id=' + bcast;
  } else {
    // use broadcaster login
    url = BASE_URL + 'live/' + bcast + '/';
  }
  return bhttp.get(url);
}).then((response) => {
  // find broadcast ticket
  const html = response.body.toString();
  let ticket = html.match(new RegExp(/&amp;file=(.*)&amp;/));
  if (ticket && typeof ticket[1] === 'string') {
    ticket = ticket[1];
  } else if (html.indexOf('Трансляция не найдена') > -1) {
    throw new Error('Broadcast not found');
  } else if (html.indexOf('Трансляция не одобрена модератором') > -1) {
    throw new Error('Broadcast banned');
  } else if (html.indexOf('Страница не найдена') > -1) {
    throw new Error('Page not found');
  } else if (html.indexOf('Юзер не найден') > -1) {
    throw new Error('User not found');
  } else {
    throw new Error('Ticket unavailable');
  }
  return ticket;
}).then((ticket) => {
  // get json with broadcast data
  const url = BASE_URL + 'broadcast/view/url/?xt=' + ticket;
  const sid = '0'.repeat(32);
  const data = { ticket, sid };
  if (pass) {
    data.pass = crypto.createHash('md5').update(pass).digest('hex');
  }
  return bhttp.post(url, data);
}).then((response) => {
  const html = response.body.toString();
  let json;
  try {
    json = JSON.parse(html);
  } catch (error) {
    logError('JSON parse error');
  }
  if (json._pass_protected) {
    throw new Error(pass ? 'Wrong password' : 'Password protected');
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
  if (!!json._imgURL && json._imgURL.substr(0, 7) === '//pics.') {
    delete json._imgURL;
  }
  logSuccess(json);
  storeBroadcastData(json);
  return json;
})
.then((json) => {
  capture(json);
})
.catch((error) => {
  logError(error.toString().split('Error: ').pop());
});

function storeBroadcastData(json) {
  const bid = json._streamName.split('_')[1];
  const path = broadcastsDirectory + parseInt(bid, 10) + '.json';
  return jsonfile.writeFile(path, json);
}

function capture(json) {
  const fileName = [
    json._streamName.split('_').slice(0, 2).join('_'),
    moment().format('YYYYMMDDHHmmss'),
    json.login,
  ].join('_') + '.flv';

  return Promise.try(() => {
    const spawnArgs = [
      '-v',
      '-m', 3600,
      '-r', json._server + '/' + json._streamName,
      '-a', 'broadcast/' + json._streamName,
      '-f', 'WIN 12,0,0,77',
      '-W', 'fws.yalp_tsacdaorb/moc.irtoms.scip//:ptth'.split('').reverse().join(''),
      '-C', 'S:' + '0'.repeat(32),
      '-y', json._streamName,
      '-o', captureDirectory + fileName,
    ];

    const captureProcess = childProcess.spawn('rtmpdump', spawnArgs);
    capture.process = captureProcess;
    capture.process.fileName = fileName;

    captureProcess.stderr.on('data', (data) => {
      let chunk = data.toString().trim();
      const omitedMessages = [
        'Caught signal: 2',
        'RTMPDump v',
        'INFO: Metadata',
      ];
      if (omitedMessages.some(begin => !chunk.indexOf(begin))) {
        return;
      }
      const errorMessages = [
        'Failed to open file',
      ];
      if (errorMessages.some(begin => !chunk.indexOf(begin))) {
        logError(chunk);
        process.exit(1);
      }
      if (chunk === 'INFO: Connected...') {
        chunk = 'Connected';
      }
      log(chunk);
    });

    captureProcess.on('error', (error) => {
      throw error;
    });

    captureProcess.on('close', () => {
      log('Disconnected');
      capture(json);
    });

    log('Start recording ' + colors.green(json.login));
  }).catch((error) => {
    logError(error.toString());
  });
}

process.on('SIGINT', () => {
  if (undefined !== capture.process) {
    capture.process.kill('SIGKILL');

    const path = captureDirectory + capture.process.fileName;
    if (!fs.statSync(path).size) {
      fs.unlink(path);
    }
  }
  process.exit(0);
});

function log(txt, color) {
  console.log(
    colors.blue('[' + moment().format('YYYY-MM-DD HH:mm:ss') + ']'),
    color ? colors[color](txt) : txt);
}
function logSuccess(txt) {
  log(txt, 'green');
}
function logError(txt) {
  log(txt, 'red');
}
