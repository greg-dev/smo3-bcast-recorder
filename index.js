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
const levenstein = require('levenshtein-string-distance');
const notifier = require('node-notifier');

const BASE_URL = `http://sm${'o'}tri.com/`;
const PICS_URL = BASE_URL.replace('//', '//pics.');
const SWF_FILE = `broadcast${'_'}play.swf`;
const BCAST_VW = `broadcast${'/'}view`;

const captureDirectory = 'captures/';
const broadcastsDirectory = 'broadcasts/';

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
    'connect ENETUNREACH',
    'connect ECONNREFUSED',
    'The connection timed out',
  ].some(error => output.startsWith(error))) {
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
  const [, vkid] = login.match(new RegExp(/^(\d*)-vk$/)) || [];

  const similar = name => levenstein(name, login) < 3;
  const favourite = favourites.includes(login) || favourites.some(similar);
  if (favourite) {
    log('Starting capture process'.green);
    childProcess.spawn('node', ['.', 'record', check.bid + '.json', 'nokill']);
    notifier.notify({
      title: `${login} created new broadcast`,
      message: 'Starting capture process',
      sound: 'Glass',
      wait: true,
      open: BASE_URL + BCAST_VW + '?id=' + check.bid,
    });
  }

  const details = [
    nick[['reset', 'blue', 'magenta'][gender || 0]], rubric, title, description,
  ].filter(p => p).join(' | ');
  log([
    check.bid,
    `${BASE_URL}${BCAST_VW}?id=${check.bid}`,
    `${BASE_URL}user/${login}`,
    vkid ? `https://vk.com/id${vkid}` : null,
    details,
  ].filter(line => line).join('\n'));

  check.bid += 1;
  return true;
}

function getRunningCaptureProcesses() {
  const command = [
    'ps xo ppid,pid,command',
    'grep "rtmpdump"',
    'sed "s/^ *//;s/ *$//"',
    'tr -s " "',
    'cut -d " " -f 1,2,21',
  ].join(' | ');
  return new Promise((resolve, reject) => {
    childProcess.exec(command, (error, stdout) => {
      if (error) {
        reject([]);
        return;
      }
      const lines = stdout
        .split(/\r?\n/)
        .filter(line => line.match(new RegExp(/^\d* \d* .*\.flv$/)));
      const processes = lines.map((line) => {
        const [ppid, pid, filepath] = line.split(' ');
        const filename = filepath.split('/').pop().split('.flv')[0];
        const [uid, bid, , ...loginParts] = filename.split('_');
        const login = loginParts.join('_');
        return ({ ppid, pid, filename, uid, bid, login });
      });
      processes.sort((x, y) => {
        if (x.uid === y.uid) {
          return x.bid > y.bid ? 1 : -1;
        }
        return x.uid > y.uid ? 1 : -1;
      });
      resolve(processes);
    });
  });
}

function logCaptureProcesses(processes) {
  processes.forEach(ps => console.log(
    'kill -9 ' + ps.ppid + ' ' + ps.pid,
    BASE_URL + BCAST_VW + '?id=' + ps.bid,
    ps.login,
  ));
}

function kill(bid) {
  if (/^\d{7,8}$/.test(bid)) {
    getRunningCaptureProcesses().then((processes) => {
      processes.forEach((ps) => {
        if (ps.bid === bid) {
          childProcess.exec(`kill -9 ${ps.ppid} ${ps.pid}`, () => {
            getRunningCaptureProcesses().then(logCaptureProcesses);
          });
        }
      });
    });
  } else {
    getRunningCaptureProcesses().then(logCaptureProcesses);
  }
}

function run(action, bcast, pass) {
  if (action === 'record' && bcast.split('.').pop() === 'json') {
    recordStored(bcast);
    return;
  }

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
    } else if (html.includes('Трансляция не найдена')) {
      throw new Error('Broadcast not found');
    } else if (html.includes('Трансляция не одобрена модератором')) {
      throw new Error('Broadcast banned');
    } else if (html.includes('Страница не найдена')) {
      throw new Error('Page not found');
    } else if (html.includes('Юзер не найден')) {
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
}

function cleanup(orig) {
  const json = Object.assign({}, orig);
  [
    'current_time',
    'is_play',
    '_pass_protected',
    '_vidURL',
    '_chatURL',
    '_chat_server',
    'begun_url_1',
    'begun_url_2',
    'begun_url_3',
    'begun_url_4',
    'video_id',
    'author_id',
    'fakestatus',
    'remote_ip',
    'save_error',
    'rubric_broadcastlink',
  ].forEach((param) => {
    delete json[param];
  });
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

function recordStored(bcast) {
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
        notifier.notify({
          title: `${json.login} started streaming`,
          message: 'Recording...',
          sound: 'Sosumi',
          wait: true,
          open: BASE_URL + BCAST_VW + '?id=' + json._streamName.split('_')[1],
        });
      } else if ([ // unimportant info
        'Caught signal: 2',
        'RTMPDump v',
        '(c)',
        'INFO:',
      ].some(info => chunk.startsWith(info))) {
        // do nothing
      } else if ([ // no error, but restart needed
        'Download complete',
      ].some(info => chunk.startsWith(info))) {
        log(chunk);
        // kill the current rtmpdump process and restart recording immediately
        capture.restartDelay = 0;
        capture.process.murder();
        return false;
      } else if ([ // minor error, but can block the capture process forever
        'ERROR: RTMP_ReadPacket, failed to read RTMP packet',
        'ERROR: WriteN, RTMP send error 32',
        'ERROR: Couldn\'t verify the server digest',
        'WARNING: HandShake: Type mismatch',
        'WARNING: Trying different position for server digest',
        'Caught signal: 13, cleaning up, just a second...',
        'Download may be incomplete',
      ].some(error => chunk.startsWith(error))) {
        logError(chunk);
        // kill the current rtmpdump process and restart recording immediately
        capture.restartDelay = 0;
        capture.process.murder();
        return false;
      } else if ([ // temporary problem that might need some time to resolve
        'ERROR: RTMP_HashSWF: connection lost while downloading swfurl',
        'ERROR: RTMP_Connect0, failed to connect socket.',
        'ERROR: RTMP_Connect1, handshake failed.',
        'ERROR: Problem accessing the DNS',
      ].some(error => chunk.startsWith(error))) {
        logError(chunk);
        // kill the current rtmpdump process and restart recording with a delay
        capture.restartDelay = 120000;
        capture.process.murder();
        return false;
      } else if ([ // fatal error
        'Failed to open file',
        'ERROR: Download: Failed writing, exiting!',
      ].some(error => chunk.startsWith(error))) {
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
        try {
          fs.unlink(path, err => err);
        } catch (error) {
          // output file already deleted
        }
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

const [action, bcast, arg3] = process.argv.slice(2);
if (undefined === action || undefined === bcast) {
  logError('Missing required params.');
  process.exit(0);
} else if (!['record', 'store', 'watch', 'kill'].includes(action)) {
  logError('Unsupported command.');
  process.exit(0);
}

process.on('SIGINT', () => {
  if (arg3 !== 'nokill' && undefined !== capture.process) {
    capture.process.murder();
  }
  process.exit(0);
});

switch (action) {
  case 'kill':
    kill(bcast);
    break;

  // eslint-disable-next-line no-case-declarations
  case 'watch':
    const timeout = (parseInt(arg3, 10) || 10) * 1000;
    check.bid = parseInt(bcast, 10);
    setInterval(check, timeout);
    break;

  case 'record':
  case 'store':
  default:
    run(action, bcast, arg3);
    break;
}
