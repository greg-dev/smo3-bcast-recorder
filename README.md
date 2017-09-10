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
6. Copy the `favorites.example.js` file, rename it to `favorites.js` 
and fill it with logins of the broadcasters you want have automatically recorded in the `watch mode`.

## Running
1. Open console and go into the directory where you unpacked the files.
2. To create new recording process and lock it on a broadcast use the `record` command 
and broadcaster login or broadcast identifier as in the examples below:
 * run `npm run record mashka4189`
 * run `npm run record 10438720`
<br/><br/>you can add `.json` suffix to broadcast id to start recording using its data stored previously in a file:
 * run `npm run record 10438720.json`
3. To store broadcast data without recording any video stream use the `store` command as below:
 * run `npm run store mashka4189`
 * run `npm run store 10438720`
4. To access protected broadcasts in all above cases use the password as an optional parameter, for example:
 * run `npm run record mashka4189 1234`
5. To keep tracking newest broadcasts and automatically capture your favs use the `watch mode`,
and pass the latest broadcast id and set time interval (the reasonable value is from 10 to 60 seconds).
* run `npm run watch 10438720 30`
6. To get the list of currently running capture processes use the `kill` command as below:
* run `npm run kill list`
<br/><br/>you can also stop recording broadcast by passing its id as an optional parameter:
* run `npm run kill 10438720`

>Note: Avoid running more than 75 capture processes at the same time or you will get your IP banned.

>Note: The command below might be useful for finding and killing unwanted capture processes:
><br/>
>`ps xo ppid,pid,command | grep 'rtmpdump' | sed 's/^ *//;s/ *$//' | tr -s " " | cut -d " " -f 1,2,21`
><br/>
>It will list all your capture processes with their PID, PPID and output file name,
the first two ids are needed to kill the process with `kill -9 PPID PID`
and the third one will help you localize it.
