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

let client: LanguageClient;
let currentPanel: vscode.WebviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
	let pGraphs = new PerformanceGraphs();

	initializePerformanceWebview(context, pGraphs);
	initializeLanguageServer(context).then((_client: LanguageClient) => {
		client = _client;
		client.onNotification("dockerlive/performanceStats", (data) => {
			let message = pGraphs.update(data);

			if (!currentPanel) {
				return; //No need to update graph if the webview panel doesn't exist / isn't visible
			} else {
				currentPanel.webview.postMessage(message);
			}
		});
	});
}

async function initializePerformanceWebview(context: vscode.ExtensionContext, pGraphs: PerformanceGraphs) {
	context.subscriptions.push(
		vscode.commands.registerCommand('dockerlive.showPerformance', () => {
			const columnToShowIn = vscode.window.activeTextEditor
				? vscode.window.activeTextEditor.viewColumn + 1
				: vscode.ViewColumn.Two;

			if (!currentPanel) {
				// Create and show a new webview
				currentPanel = vscode.window.createWebviewPanel(
					'dockerlivePerformance', // Identifies the type of the webview. Used internally
					'Dockerlive', // Title of the panel displayed to the user
					columnToShowIn, // Editor column to show the new webview panel in.
					{
						enableScripts: true
					} // Webview options.
				);
			} else {
				currentPanel.reveal();
			}

			currentPanel.onDidDispose((_e) => {
				currentPanel = null;
			})

			currentPanel.webview.html = pGraphs.getHTML();

			currentPanel.webview.onDidReceiveMessage(
				message => {
					switch (message.command) {
						case 'stop':
							client.sendNotification("dockerlive/stop");
							return;
						case 'restartBuild':
							client.sendNotification("dockerlive/restart");
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

export function deactivate(): Thenable<void> | undefined { //TODO - Check extension lifecycle - this might be a good spot to terminate the last running container
	if (!client) {
		return undefined;
	}
	return client.stop();
}
