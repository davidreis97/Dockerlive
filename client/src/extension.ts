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

let client : LanguageClient;
let currentPanel: vscode.WebviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
	let pGraphs = new PerformanceGraphs();

	initializePerformanceWebview(context);
	initializeLanguageServer(context).then((_client : LanguageClient) => {
		client = _client;
		client.onNotification("dockerlive/performanceStats",(data) => {
			if(!currentPanel){ //Information is always sent by the server anyway - it'd be more efficent to only send information if the panel was open
				return;
			}
			pGraphs.update(data);
			currentPanel.webview.html = pGraphs.getHTML();
		});
	});
}

async function initializePerformanceWebview(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('dockerlive.showPerformance', () => {
			const columnToShowIn = vscode.window.activeTextEditor
				? vscode.window.activeTextEditor.viewColumn + 1
				: vscode.ViewColumn.Two;

			if(!currentPanel){
				// Create and show a new webview
				currentPanel = vscode.window.createWebviewPanel(
					'dockerlivePerformance', // Identifies the type of the webview. Used internally
					'Dockerlive', // Title of the panel displayed to the user
					columnToShowIn, // Editor column to show the new webview panel in.
					{
						enableScripts: true
					} // Webview options.
				);
			}else{
				currentPanel.reveal();
			}
		})
	);
}

async function initializeLanguageServer(context: vscode.ExtensionContext) : Promise<LanguageClient>{
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
