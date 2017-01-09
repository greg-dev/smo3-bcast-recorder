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
} else if (!['record', 'store'].some(supported => action === supported)) {
  logError('Unsupported command.');
  process.exit(0);
}

const BASE_URL = `http://sm${'o'}tri.com/`;
const PICS_URL = BASE_URL.replace('//', '//pics.');
const SWF_FILE = `broadcast${'_'}play.swf`;
const BCAST_VW = `broadcast${'/'}view`;

Promise.try(() => {
  let url;
  // get proper page with brodcast tickets
  if (bcast === bcast.replace(/\D/g, '')) {
    // use broadcast id
    url = BASE_URL + BCAST_VW + '?id=' + bcast;
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
  const url = BASE_URL + BCAST_VW + '/url/?xt=' + ticket;
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
    throw new Error('JSON parse error');
  }
  if (json._pass_protected) {
    throw new Error(pass ? 'Wrong password' : 'Password protected');
  }
  if (pass) {
    json.pass = pass;
  }
  return json;
})
.then((json) => {
  if (action === 'store' || action === 'record') {
    storeBroadcastData(json);
  }
  return json;
})
.then((json) => {
  if (action === 'record') {
    capture(json);
  }
})
.catch((error) => {
  logError(error.toString().split('Error: ').pop());
});

function cleanup(orig) {
  const json = Object.assign({}, orig);
  delete json.current_time;
  delete json.is_play;
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
  log(colors.green(JSON.stringify(json)));
  return json;
}

function storeBroadcastData(json) {
  const bid = json._streamName.split('_')[1];
  const path = broadcastsDirectory + parseInt(bid, 10) + '.json';
  return jsonfile.writeFile(path, cleanup(json));
}

function capture(json) {
  capture.restartDelay = 0;

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
      '-W', PICS_URL + SWF_FILE,
      '-C', 'S:' + '0'.repeat(32),
      '-y', json._streamName,
      '-o', captureDirectory + fileName,
    ];

    const captureProcess = childProcess.spawn('rtmpdump', spawnArgs);
    capture.process = captureProcess;

    captureProcess.stderr.on('data', (data) => {
      const chunk = data.toString().trim();
      if (!isNaN(parseInt(chunk[0], 10))) { // download progress
        log(chunk);
      } else if (chunk === 'Connecting ...') {
        log('Connecting...');
      } else if (chunk === 'INFO: Connected...') {
        log('Connected. Waiting for live stream...');
      } else if (chunk === 'Starting Live Stream') {
        log('Recording...');
      } else if ([ // unimportant info
        'Caught signal: 2',
        'RTMPDump v',
        'INFO:',
      ].some(begin => !chunk.indexOf(begin))) {
        // do nothing
      } else if ([ // minor error, but can block the capture process forever
        'ERROR: RTMP_ReadPacket, failed to read RTMP packet header',
        'Caught signal: 13, cleaning up, just a second...',
      ].some(begin => !chunk.indexOf(begin))) {
        logError(chunk);
        // kill the current rtmpdump process and restart recording immediately
        capture.restartDelay = 0;
        capture.process.murder();
      } else if ([ // temporary problem that might need some time to resolve
        'ERROR: RTMP_Connect0, failed to connect socket.',
        'ERROR: RTMP_Connect1, handshake failed.',
        'ERROR: Problem accessing the DNS',
      ].some(begin => !chunk.indexOf(begin))) {
        logError(chunk);
        // kill the current rtmpdump process and restart recording with a delay
        capture.restartDelay = 120000;
        capture.process.murder();
      } else if ([ // fatal error
        'Failed to open file',
      ].some(begin => !chunk.indexOf(begin))) {
        logError(chunk);
        process.exit(1);
      } else { // unexpected output
        log(colors.rainbow(chunk));
        process.exit(0);
      }
    });

    captureProcess.on('error', (error) => {
      throw error;
    });

    captureProcess.on('close', () => {
      log('Disconnected');
      captureProcess.murder();
      setTimeout(() => {
        capture(json);
      }, capture.restartDelay);
    });

    captureProcess.murder = () => {
      captureProcess.kill('SIGKILL');
      const path = captureDirectory + fileName;
      if (fs.existsSync(path) && !fs.statSync(path).size) {
        fs.unlink(path);
      }
    };
  }).catch((error) => {
    logError(error.toString());
  });
}

process.on('SIGINT', () => {
  if (undefined !== capture.process) {
    capture.process.murder();
  }
  process.exit(0);
});

function log(txt) {
  console.log('[%s]'.blue, moment().format('YYYY-MM-DD HH:mm:ss'), txt);
}
function logError(txt) {
  log(colors.red(txt));
}
