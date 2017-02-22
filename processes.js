'use strict';

/* eslint-disable no-console, no-use-before-define */
const childProcess = require('child_process');

const BASE_URL = `http://sm${'o'}tri.com/`;
const BCAST_VW = `broadcast${'/'}view`;

const captureDirectory = 'captures/';

processes();

function processes() {
  const commands = `
    ps xo ppid,pid,command
    grep 'rtmpdump'
    sed 's/^ *//;s/ *$//'
    tr -s " "
    cut -d " " -f 1,2,21
  `.trim().split('\n').join(' | ');
  const out = childProcess.execSync(commands).toString('utf8')
    .split('\n')
    .map((line) => {
      const [pids, filename] = line.split(captureDirectory);
      if (filename) {
        return `kill -9 ${pids}
        ${(BASE_URL + BCAST_VW)}/?id=${filename.split('_')[1]}
        ${filename}`
      .split('\n')
      .map(p => p.trim())
      .filter(p => !!p)
      .join(' ');
      }
      return null;
    })
    .filter(line => !!line)
    .join('\n');
  clearConsole();
  console.log(out);
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
