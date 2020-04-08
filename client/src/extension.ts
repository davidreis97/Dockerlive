/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import * as vscode from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';
import { PerformanceGraphs } from './performance';
import { FilesystemVisualizer } from './filesystem';

let client: LanguageClient;
let performanceCurrentPanel: vscode.WebviewPanel | undefined;
let filesystemCurrentPanel: vscode.WebviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
	let pGraphs = new PerformanceGraphs();
	let fsViz = new FilesystemVisualizer();

	vscode.commands.registerCommand('dockerlive.stop', () => {
		client.sendNotification("dockerlive/stop");
	});

	vscode.commands.registerCommand('dockerlive.restart', () => {
		client.sendNotification("dockerlive/restart");
	});

	vscode.commands.registerCommand('dockerlive.openShell', () => {
		client.sendNotification("dockerlive/getContainerName");
	});

	let codeLensProvider = new DockerfileCodeLensProvider();

	initializePerformanceWebview(context, pGraphs);
	initializeFilesystemWebview(context, fsViz);
	initializeLanguageServer(context).then((_client: LanguageClient) => {
		client = _client;
		client.onNotification("dockerlive/performanceStats", (data) => {
			let message = pGraphs.update(data);

			if (!performanceCurrentPanel) {
				return; //No need to update graph if the webview panel doesn't exist / isn't visible
			} else {
				performanceCurrentPanel.webview.postMessage(message);
			}
		});

		client.onNotification("dockerlive/filesystemData", (data) => {
			let message = fsViz.update(data);

			if (!filesystemCurrentPanel) {
				return; //No need to update graph if the webview panel doesn't exist / isn't visible
			} else {
				filesystemCurrentPanel.webview.postMessage(message);
			}
		});

		client.onNotification("dockerlive/containerName", (data) => {
			vscode.window.showInputBox({
				prompt: "Command to be executed",
				value: `docker exec -it ${data.containerName} /bin/sh`
			}).then((command: string) => {
				if (!command) {
					return;
				}

				const terminal = vscode.window.createTerminal("Dockerlive Container");
				terminal.sendText(command);
				terminal.show();
			})
		});

		client.onNotification("dockerlive/didChangeCodeLenses", (data) => {
			codeLensProvider.didChangeCodeLenses(data.codeLenses);
		})
	});
}

async function initializeFilesystemWebview(context: vscode.ExtensionContext, fsViz: FilesystemVisualizer) {
	context.subscriptions.push(
		vscode.commands.registerCommand('dockerlive.showFilesystem', () => {
			const columnToShowIn = vscode.window.activeTextEditor
				? vscode.window.activeTextEditor.viewColumn + 1
				: vscode.ViewColumn.Two;

			if (!filesystemCurrentPanel) {
				// Create and show a new webview
				filesystemCurrentPanel = vscode.window.createWebviewPanel(
					'dockerliveFilesystem', // Identifies the type of the webview. Used internally
					'Filesystem', // Title of the panel displayed to the user
					columnToShowIn, // Editor column to show the new webview panel in.
					{
						enableScripts: true
					} // Webview options.
				);
			} else {
				filesystemCurrentPanel.reveal();
			}

			filesystemCurrentPanel.onDidDispose((_e) => {
				filesystemCurrentPanel = null;
			})

			filesystemCurrentPanel.webview.html = fsViz.getHTML();

			filesystemCurrentPanel.webview.onDidReceiveMessage(
				message => {
					/*
					switch (message.command) {
						case 'stop':
							vscode.commands.executeCommand("dockerlive.stop");
							return;
						case 'restartBuild':
							vscode.commands.executeCommand("dockerlive.restart");
							return;
						case 'openShell':
							vscode.commands.executeCommand("dockerlive.openShell");
							return;
					}
					*/
				},
				undefined,
				context.subscriptions
			);
		})
	);
}

async function initializePerformanceWebview(context: vscode.ExtensionContext, pGraphs: PerformanceGraphs) {
	context.subscriptions.push(
		vscode.commands.registerCommand('dockerlive.showPerformance', () => {
			const columnToShowIn = vscode.window.activeTextEditor
				? vscode.window.activeTextEditor.viewColumn + 1
				: vscode.ViewColumn.Two;

			if (!performanceCurrentPanel) {
				// Create and show a new webview
				performanceCurrentPanel = vscode.window.createWebviewPanel(
					'dockerlivePerformance', // Identifies the type of the webview. Used internally
					'Performance', // Title of the panel displayed to the user
					columnToShowIn, // Editor column to show the new webview panel in.
					{
						enableScripts: true,
					} // Webview options.
				);
			} else {
				performanceCurrentPanel.reveal();
			}

			performanceCurrentPanel.onDidDispose((_e) => {
				performanceCurrentPanel = null;
			})

			const cssPath = vscode.Uri.file(
				path.join(context.extensionPath, 'client', 'resources', 'performance', 'css', 'performance.css')
			);

			const jsPath = vscode.Uri.file(
				path.join(context.extensionPath, 'client', 'resources', 'performance', 'js', 'performance.js')
			);

			const chartjsPath = vscode.Uri.file(
				path.join(context.extensionPath, 'client', 'resources', 'performance', 'js', 'Chart@2.9.3.min.js')
			);

			performanceCurrentPanel.webview.html = pGraphs.getHTML("vscode-resource:"+cssPath.fsPath,"vscode-resource:"+jsPath.fsPath,"vscode-resource:"+chartjsPath.fsPath);

			performanceCurrentPanel.webview.onDidReceiveMessage(
				message => {
					switch (message.command) {
						case 'stop':
							vscode.commands.executeCommand("dockerlive.stop");
							return;
						case 'restartBuild':
							vscode.commands.executeCommand("dockerlive.restart");
							return;
						case 'openShell':
							vscode.commands.executeCommand("dockerlive.openShell");
							return;
					}
				},
				undefined,
				context.subscriptions
			);
		})
	);
}

async function initializeLanguageServer(context: vscode.ExtensionContext): Promise<LanguageClient> {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join('dockerfile-language-server-nodejs', 'out', 'dockerfile-language-server-nodejs', 'src', 'server.js')
	);

	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc, args: ["--node-ipc"] },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'dockerfile' }],
	};

	// Create the language client and start the client.
	let client = new LanguageClient(
		'dockerlive',
		'dockerlive',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();

	await client.onReady();

	return client;
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	client.sendNotification("dockerlive/stop");
	return client.stop();
}

//	Necessary workaround in order to change the text of an existing CodeLens
//	since the event onDidChangeCodeLenses is not yet supported in the LSP
//	See: https://github.com/microsoft/language-server-protocol/issues/192
class DockerfileCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	private codeLenses: vscode.CodeLens[] = [];

	constructor(){
		vscode.languages.registerCodeLensProvider({
			scheme: 'file', language: 'dockerfile'
		},this);
	}

	didChangeCodeLenses(codeLenses: vscode.CodeLens[]){
		this.codeLenses = codeLenses;
		this._onDidChangeCodeLenses.fire();
	}

	provideCodeLenses(_document: vscode.TextDocument): vscode.CodeLens[] {
		return this.codeLenses;
	}

	resolveCodeLens(codeLens: vscode.CodeLens): vscode.CodeLens{
		return codeLens;
	}
}