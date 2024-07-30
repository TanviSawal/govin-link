const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const ansi = require('ansi-string');
const os = require('os');

const ABORT_STATE_CHECK_INTERVAL = 100;

class MicroPython {
    constructor(peripheralPath, config, userDataPath, toolsPath, sendstd) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._userDataPath = userDataPath;
        this._projectPath = path.join(userDataPath, 'micropython/project');
        this._toolsPath = toolsPath;
        this._sendstd = sendstd;

        this._abort = false;
        this._codefilePath = path.join(this._projectPath, 'main.py');

        this._ampyPath = 'ampy'; // Ensure 'ampy' is installed and available in the PATH
    }

    abortUpload() {
        this._abort = true;
    }

    async flash(code, library = []) {
        const filesToPut = [];

        if (!fs.existsSync(this._projectPath)) {
            fs.mkdirSync(this._projectPath, { recursive: true });
        }

        try {
            fs.writeFileSync(this._codefilePath, code);
        } catch (err) {
            return Promise.reject(err);
        }

        filesToPut.push(this._codefilePath);

        library.forEach(lib => {
            if (fs.existsSync(lib)) {
                const libraries = fs.readdirSync(lib);
                libraries.forEach(file => {
                    filesToPut.push(path.join(lib, file));
                });
            }
        });

        this._sendstd('Writing files...\n');

        for (const file of filesToPut) {
            const result = await this.putFile(file);
            if (result !== 'Success') {
                return Promise.reject(result);
            }
            if (this._abort) {
                return Promise.resolve('Aborted');
            }
        }

        this._sendstd(`${ansi.green_dark}Success\n`);
        return Promise.resolve('Success');
    }

    putFile(file) {
        return new Promise((resolve, reject) => {
            const args = ['--port', this._peripheralPath, 'put', file];
            const ampy = spawn(this._ampyPath, args);

            ampy.stdout.on('data', buf => {
                this._sendstd(buf.toString());
            });

            ampy.stderr.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
            });

            const listenAbortSignal = setInterval(() => {
                if (this._abort) {
                    ampy.kill();
                }
            }, ABORT_STATE_CHECK_INTERVAL);

            ampy.on('exit', code => {
                clearInterval(listenAbortSignal);
                if (code === null) {
                    return resolve('Aborted');
                } else if (code === 0) {
                    this._sendstd(`${file} write finished\n`);
                    return resolve('Success');
                } else {
                    return reject('Failed to write file');
                }
            });
        });
    }
}

module.exports = MicroPython;
