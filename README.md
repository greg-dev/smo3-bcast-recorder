# smo3-broadcast-recorder

[Smоtri.cоm](https://href.li/?http://ujeb.se/TVkzK) is one of the most popular russian video hosting sites with a big community and live broadcasts.
<br />
This tool lets you automatically record your favorite shows right from the terminal.

## Requirements
[Node.js](https://nodejs.org/) used to retrieve broadcasts stream data.
<br/>
[rtmpdump](https://rtmpdump.mplayerhq.hu/) used to connect to RTMP server and capture the live video stream and save it to a file.

##Setup
1. Install [Node.js](https://nodejs.org/en/download/) (tested on `6.9.x`).
2. Download and unpack the [code](https://github.com/greg-dev/smo3-bcast-recorder/archive/master.zip).
3. Open console and go into the directory where you unpacked the files.
4. Install all dependencies by running `npm install` in the same directory as `index.js` is.
5. Install [rtmpdump](http://rtmpdump.mplayerhq.hu/).

## Running
1. Open console and go into the directory where you unpacked the files.
2. To create new recording process and lock it on a broadcast use the `record` command 
and broadcaster login or broadcast identifier as in the examples below:
 * run `node . record mashka4189`
 * run `node . record 10438720`
3. To store broadcast data without recording any video stream use the `store` command as below:
 * run `node . store mashka4189`
 * run `node . store 10438720`
4. To access protected broadcasts in all above cases use the password as an optional parameter, for example:
 * run `node . get mashka4189 1234`

