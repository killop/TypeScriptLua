import * as ts from 'typescript';
import * as fs from 'fs-extra';
import { spawn } from 'cross-spawn';
import { Emitter } from './emitter';
import { EmitterLua } from './emitterlua';
import { Helpers } from './helpers';

export enum ForegroundColorEscapeSequences {
    Grey = '\u001b[90m',
    Red = '\u001b[91m',
    Green = '\u001b[92m',
    Yellow = '\u001b[93m',
    Blue = '\u001b[94m',
    Pink = '\u001b[95m',
    Cyan = '\u001b[96m',
    White = '\u001b[97m'
}
export enum BackgroundColorEscapeSequences {
    Grey = '\u001b[100m',
    Red = '\u001b[101m',
    Green = '\u001b[102m',
    Yellow = '\u001b[103m',
    Blue = '\u001b[104m',
    Pink = '\u001b[105m',
    Cyan = '\u001b[106m',
    White = '\u001b[107m'
}
export enum BoldForegroundColorEscapeSequences {
    Grey = '\u001b[90;1m',
    Red = '\u001b[91;1m',
    Green = '\u001b[92;1m',
    Yellow = '\u001b[93;1m',
    Blue = '\u001b[94;1m',
    Pink = '\u001b[95;1m',
    Cyan = '\u001b[96;1m',
    White = '\u001b[97;1m'
}
export enum BoldBackgroundColorEscapeSequences {
    Grey = '\u001b[100;1m',
    Red = '\u001b[101;1m',
    Green = '\u001b[102;1m',
    Yellow = '\u001b[103;1m',
    Blue = '\u001b[104;1m',
    Pink = '\u001b[105;1m',
    Cyan = '\u001b[106;1m',
    White = '\u001b[107;1m'
}
const underlineStyleSequence = '\u001b[4m';
const gutterStyleSequence = '\u001b[7m';
const resetEscapeSequence = '\u001b[0m';

export class Run {

    private formatHost: ts.FormatDiagnosticsHost;
    private versions: Map<string, number> = new Map<string, number>();

    public constructor() {
        this.formatHost = <ts.FormatDiagnosticsHost>{
            getCanonicalFileName: path => path,
            getCurrentDirectory: ts.sys.getCurrentDirectory,
            getNewLine: () => ts.sys.newLine
        };
    }

    public static processOptions(cmdLineArgs: string[]): any {
        const options = {};
        for (let i = 2; i < cmdLineArgs.length; i++) {
            const item = cmdLineArgs[i];
            if (!item || item[0] !== '-') {
                continue;
            }

            options[item.substring(1)] = true;
        }

        return options;
    }

    public static processFiles(cmdLineArgs: string[]): any {
        const options = [];
        for (let i = 2; i < cmdLineArgs.length; i++) {
            const item = cmdLineArgs[i];
            if (!item || item[0] === '-') {
                continue;
            }

            options.push(item);
        }

        if (options.length === 0) {
            return 'tsconfig.json';
        }

        return options.length === 1 ? options[0] : options;
    }

    public run(sourcesOrConfigFile: string[] | string, outputExtention: string, cmdLineOptions: any): void {

        if (typeof (sourcesOrConfigFile) === 'string') {
            if (sourcesOrConfigFile.endsWith('.json')) {
                const configPath = ts.findConfigFile('./', ts.sys.fileExists, sourcesOrConfigFile);
                if (configPath) {
                    this.compileWithConfig(configPath, outputExtention, cmdLineOptions);
                    return;
                } else {
                    throw new Error('Could not find a valid \'tsconfig.json\'.');
                }
            }

            this.compileSources([sourcesOrConfigFile], outputExtention, cmdLineOptions);
            return;
        }

        this.compileSources(sourcesOrConfigFile, outputExtention, cmdLineOptions);
    }

    public compileSources(sources: string[], outputExtention: string, cmdLineOptions: any): void {
        this.generateBinary(ts.createProgram(sources, {}), sources, outputExtention, undefined, cmdLineOptions);
    }

    public compileWithConfig(configPath: string, outputExtention: string, cmdLineOptions: any): void {
        const configFile = ts.readJsonConfigFile(configPath, ts.sys.readFile);

        const parseConfigHost: ts.ParseConfigHost = {
            useCaseSensitiveFileNames: true,
            readDirectory: ts.sys.readDirectory,
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile
        };

        const parsedCommandLine = ts.parseJsonSourceFileConfigFileContent(configFile, parseConfigHost, './');

        const watch = cmdLineOptions && 'watch' in cmdLineOptions;

        if (!watch) {
            // simple case, just compile
            const program = ts.createProgram({
                rootNames: parsedCommandLine.fileNames,
                options: parsedCommandLine.options
            });
            this.generateBinary(program, parsedCommandLine.fileNames, outputExtention, parsedCommandLine.options, cmdLineOptions);
        } else {
            const createProgram = ts.createEmitAndSemanticDiagnosticsBuilderProgram;

            const watchCompilingHost = ts.createWatchCompilerHost(
                configPath,
                {},
                ts.sys,
                createProgram,
                (d) => this.reportDiagnostic(d),
                (d) => this.reportWatchStatusChanged(d)
            );

            watchCompilingHost.afterProgramCreate = program => {
              this.generateBinary(
                  program.getProgram(),
                  parsedCommandLine.fileNames,
                  outputExtention,
                  parsedCommandLine.options,
                  cmdLineOptions);
            };

            console.log(ForegroundColorEscapeSequences.Cyan + 'Watching...' + resetEscapeSequence);
            ts.createWatchProgram(watchCompilingHost);
        }
    }

    private reportDiagnostic(diagnostic: ts.Diagnostic) {

        const category = ts.DiagnosticCategory[diagnostic.category];

        let action;
        let color;
        switch (<ts.DiagnosticCategory>diagnostic.category) {
            case ts.DiagnosticCategory.Warning:
                action = console.warn;
                color = ForegroundColorEscapeSequences.Yellow;
                break;
            case ts.DiagnosticCategory.Error:
                action = console.error;
                color = ForegroundColorEscapeSequences.Red;
                break;
            case ts.DiagnosticCategory.Suggestion:
                action = console.warn;
                color = ForegroundColorEscapeSequences.White;
                break;
            case ts.DiagnosticCategory.Message:
                action = console.log;
                color = resetEscapeSequence;
                break;
        }

        action(category, this.formatHost.getNewLine());
        action(
            category,
            diagnostic.code,
            ':',
            ts.flattenDiagnosticMessageText(color + diagnostic.messageText + resetEscapeSequence, this.formatHost.getNewLine()));
    }

    private reportWatchStatusChanged(diagnostic: ts.Diagnostic) {
        console.log(ts.formatDiagnostic(diagnostic, this.formatHost));
    }

    private generateBinary(
        program: ts.Program, sources: string[], outputExtention: string, options: ts.CompilerOptions, cmdLineOptions: any) {

        console.log(ForegroundColorEscapeSequences.Pink + 'Generating binary files...' + resetEscapeSequence);

        const sourceFiles = program.getSourceFiles();

        const textOutput = cmdLineOptions && cmdLineOptions.text;
        const isSingleModule = cmdLineOptions && cmdLineOptions.singleModule;
        if (!isSingleModule) {
            sourceFiles.filter(s => !s.fileName.endsWith('.d.ts') && sources.some(sf => s.fileName.endsWith(sf))).forEach(s => {
                // track version
                const paths = sources.filter(sf => s.fileName.endsWith(sf));
                (<any>s).__path = paths[0];
                const fileVersion = (<any>s).version;
                if (fileVersion) {
                    const latestVersion = this.versions[s.fileName];
                    if (latestVersion && parseInt(latestVersion) >= parseInt(fileVersion)) {
                        console.log(
                            'File: '
                            + ForegroundColorEscapeSequences.White
                            + s.fileName
                            + resetEscapeSequence
                            + ' current version:'
                            + fileVersion
                            + ', last version:'
                            + latestVersion
                            + '. '
                            + ForegroundColorEscapeSequences.Red
                            + 'Skipped.'
                            + resetEscapeSequence);
                        return;
                    }

                    this.versions[s.fileName] = fileVersion;
                }

                console.log(
                    ForegroundColorEscapeSequences.Cyan
                    + 'Processing File: '
                    + resetEscapeSequence
                    + ForegroundColorEscapeSequences.White
                    + s.fileName
                    + resetEscapeSequence);
                const emitter = textOutput
                    ? new EmitterLua(program.getTypeChecker(), options, cmdLineOptions, false, program.getCurrentDirectory())
                    : new Emitter(program.getTypeChecker(), options, cmdLineOptions, false, program.getCurrentDirectory());

                emitter.processNode(s);
                emitter.save();

                const fileNamnNoExt = s.fileName.endsWith('.ts') ? s.fileName.substr(0, s.fileName.length - 3) : s.fileName;
                const fileName = Helpers.correctFileNameForLua(fileNamnNoExt.concat('.', outputExtention));

                console.log(
                    ForegroundColorEscapeSequences.Cyan
                    + 'Writing to file: '
                    + resetEscapeSequence
                    + ForegroundColorEscapeSequences.White
                    + s.fileName
                    + resetEscapeSequence);

                fs.writeFileSync(fileName, emitter.writer.getBytes());
            });
        } else {
            const emitter = textOutput
                ? new EmitterLua(program.getTypeChecker(), options, cmdLineOptions, true, program.getCurrentDirectory())
                : new Emitter(program.getTypeChecker(), options, cmdLineOptions, true, program.getCurrentDirectory());
            sourceFiles.forEach(s => {
                const paths = sources.filter(sf => s.fileName.endsWith(sf));
                if (paths && paths.length > 0) {
                    (<any>s).__path = paths[0];
                    emitter.processNode(s);
                    console.log('File: ' + ForegroundColorEscapeSequences.White + s.fileName + resetEscapeSequence);
                }
            });

            const fileName = (emitter.fileModuleName || 'out').replace(/\./g, '_') + '.' + outputExtention;

            console.log(
                ForegroundColorEscapeSequences.Cyan
                + 'Writing to file '
                + resetEscapeSequence
                + ForegroundColorEscapeSequences.White
                + fileName
                + resetEscapeSequence);

            emitter.save();
            fs.writeFileSync(fileName, emitter.writer.getBytes());
        }

        console.log(ForegroundColorEscapeSequences.Pink + 'Binary files have been generated...' + resetEscapeSequence);
    }

    public test(sources: string[], cmdLineOptions?: any): string {
        let actualOutput = '';

        const tempSourceFiles = sources.map((s: string, index: number) => 'test' + index + '.ts');
        const tempLuaFiles = sources.map((s: string, index: number) => 'test' + index + '.lua');

        const textOutput = true;//cmdLineOptions && cmdLineOptions.text;

        // clean up
        tempSourceFiles.forEach(f => {
            if (fs.existsSync(f)) { fs.unlinkSync(f); }
        });
        tempLuaFiles.forEach(f => {
            if (fs.existsSync(f)) { fs.unlinkSync(f); }
        });

        try {
            sources.forEach((s: string, index: number) => {
                fs.writeFileSync('test' + index + '.ts', s.replace(/console\.log\(/g, 'print('));
            });

            const program = ts.createProgram(tempSourceFiles, {});
            const emitResult = program.emit(undefined, (f, data, writeByteOrderMark) => {
                // ts.sys.writeFile(f, data, writeByteOrderMark);
            });

            emitResult.diagnostics.forEach((d: ts.Diagnostic) => {
                switch (d.category) {
                    case 1: throw new Error('Error: ' + d.messageText + ' file: ' + d.file + ' line: ' + d.start);
                    default: break;
                }
            });

            let lastLuaFile;
            const sourceFiles = program.getSourceFiles();
            sourceFiles.forEach((s: ts.SourceFile, index: number) => {
                const currentFile = tempSourceFiles.find(sf => s.fileName.endsWith(sf));
                if (currentFile) {
                    const emitter = textOutput
                        ? new EmitterLua(program.getTypeChecker(), undefined, cmdLineOptions || {}, false)
                        : new Emitter(program.getTypeChecker(), undefined, cmdLineOptions || {}, false);
                    emitter.processNode(s);
                    emitter.save();

                    const luaFile = currentFile.replace(/\.ts$/, '.lua');
                    fs.writeFileSync(luaFile, emitter.writer.getBytes());

                    lastLuaFile = luaFile;

                }
            });

            // start program and test it to
            const result: any = spawn.sync('lua', [lastLuaFile]);
            if (result.error) {
                actualOutput = result.error.stack;
            } else {
                actualOutput = (<Uint8Array>result.stdout).toString();
            }
        } catch (e) {
            // clean up
            tempSourceFiles.forEach(f => {
                if (fs.existsSync(f)) { fs.unlinkSync(f); }
            });
            tempLuaFiles.forEach(f => {
                if (fs.existsSync(f)) { fs.unlinkSync(f); }
            });

            throw e;
        }

        // clean up
        tempSourceFiles.forEach(f => {
            if (fs.existsSync(f)) { fs.unlinkSync(f); }
        });
        tempLuaFiles.forEach(f => {
            if (fs.existsSync(f)) { fs.unlinkSync(f); }
        });

        return actualOutput;
    }
}
