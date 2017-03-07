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
const favourites = require('./favourites').favourites;
const notifier = require('node-notifier');

const BASE_URL = `http://sm${'o'}tri.com/`;
const PICS_URL = BASE_URL.replace('//', '//pics.');
const SWF_FILE = `broadcast${'_'}play.swf`;
const BCAST_VW = `broadcast${'/'}view`;

const captureDirectory = 'captures/';
const broadcastsDirectory = 'broadcasts/';

const [action, bcast, opt1] = process.argv.slice(2);
if (undefined === action || undefined === bcast) {
  logError('Missing required params.');
  process.exit(0);
} else if (!['record', 'store', 'watch'].includes(action)) {
  logError('Unsupported command.');
  process.exit(0);
}

process.on('SIGINT', () => {
  if (opt1 !== 'nokill' && undefined !== capture.process) {
    capture.process.murder();
  }
  process.exit(0);
});

function check() {
  let output = childProcess.spawnSync('node', ['.', 'store', check.bid]).output
    .filter(chunk => !!chunk) // remove nulls
    .map(chunk => chunk.toString().trim())
    .filter(chunk => !!chunk) // remove empty lines
    .pop() // get last message
    .substr(22); // chop off timestamp

  if (['Broadcast not found', 'Ticket unavailable'].includes(output)) {
    // broadcast not yet created or page temporary unavailable => try again
    log(`${check.bid} -`);
    return false;
  }

  if ([
    'getaddrinfo ENOTFOUND',
  ].some(begin => !output.indexOf(begin))) {
    // temporary problem => output error message and try again
    logError(`${check.bid} ${output}`);
    return false;
  }

  try {
    output = JSON.parse(output);
  } catch (error) {
    // broadcast protected or banned etc. => check the next one
    log(`${check.bid} ${output}`);
    check.bid += 1;
    return true;
  }

  // broadcast found, not password protected
  const { login, nick, gender, rubric, title, description } = output;

  if (favourites.includes(login)) {
    log('Starting capture process'.green);
    childProcess.spawn('node', ['.', 'record', check.bid + '.json', 'nokill']);
    notifier.notify({
      title: `${login} started new broadcast`,
      message: 'Starting capture process',
      sound: 'Glass',
      wait: false,
    });
  }

  const details = [
    nick[['reset', 'blue', 'magenta'][gender || 0]], rubric, title, description,
  ].filter(p => p).join(' | ');
  log(`${check.bid}
  ${BASE_URL}${BCAST_VW}?id=${check.bid}
  ${BASE_URL}user/${login}
  ${details}`);

  check.bid += 1;
  return true;
}

if (action === 'watch') {
  const timeout = (parseInt(opt1, 10) || 10) * 1000;
  check.bid = parseInt(bcast, 10);
  setInterval(check, timeout);
  return;
}

// try to record using stored broadcast info
if (action === 'record' && bcast.split('.').pop() === 'json') {
  const path = broadcastsDirectory + bcast;
  if (fs.existsSync(path)) {
    let json = fs.readFileSync(path, 'utf-8').trim();
    try {
      json = JSON.parse(json);
    } catch (error) {
      logError('JSON parse error');
      return;
    }
    capture(json);
  } else {
    logError('File not found');
  }
  return;
}

const pass = opt1;
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
      const chunks = data.toString().trim().split('\n')
      .map(chunk => chunk.trim())
      .filter(chunk => !!chunk);
      for (let i = 0; i < chunks.length; i += 1) {
        if (handleOutput(chunks[i]) === false) return;
      }
    });

    function handleOutput(chunk) {
      if (!isNaN(parseInt(chunk[0], 10))) { // download progress
        clearConsole();
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
        '(c)',
        'INFO:',
      ].some(begin => !chunk.indexOf(begin))) {
        // do nothing
      } else if ([ // no error, but restart needed
        'Download complete',
      ].some(begin => !chunk.indexOf(begin))) {
        log(chunk);
        // kill the current rtmpdump process and restart recording immediately
        capture.restartDelay = 0;
        capture.process.murder();
        return false;
      } else if ([ // minor error, but can block the capture process forever
        'ERROR: RTMP_ReadPacket, failed to read RTMP packet header',
        'ERROR: WriteN, RTMP send error 32',
        'Caught signal: 13, cleaning up, just a second...',
      ].some(begin => !chunk.indexOf(begin))) {
        logError(chunk);
        // kill the current rtmpdump process and restart recording immediately
        capture.restartDelay = 0;
        capture.process.murder();
        return false;
      } else if ([ // temporary problem that might need some time to resolve
        'ERROR: RTMP_Connect0, failed to connect socket.',
        'ERROR: RTMP_Connect1, handshake failed.',
        'ERROR: Problem accessing the DNS',
      ].some(begin => !chunk.indexOf(begin))) {
        logError(chunk);
        // kill the current rtmpdump process and restart recording with a delay
        capture.restartDelay = 120000;
        capture.process.murder();
        return false;
      } else if ([ // fatal error
        'Failed to open file',
        'ERROR: Download: Failed writing, exiting!',
      ].some(begin => !chunk.indexOf(begin))) {
        logError(chunk);
        process.exit(1);
        return false;
      } else { // unexpected output
        log(colors.rainbow(chunk));
        process.exit(0);
        return false;
      }
      return true;
    }

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

function log(txt) {
  console.log('[%s]'.blue, moment().format('YYYY-MM-DD HH:mm:ss'), txt);
}

function logError(txt) {
  log(colors.red(txt));
}

function clearConsole() {
  // The first code \u001B[2J instructs the terminal to clear itself,
  // and the second one \u001B[0;0f forces the cursor back to position 0,0.
  // Unicode 1B (the ESC character), followed by the two characters [ and J,
  // an ANSI escape sequence common on many terminals.
  // we could output the <ESC>c sequence using simple '\033c'
  // but octal literals are not allowed in strict mode
  console.log('\u001B[2J\u001B[0;0f');
}
